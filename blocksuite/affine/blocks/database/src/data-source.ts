import type {
  ColumnDataType,
  ColumnUpdater,
  DatabaseBlockModel,
  ListBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/affine-model';
import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import {
  EditorSettingProvider,
  FeatureFlagService,
  TaskWorkflowDefaultsSchema,
} from '@blocksuite/affine-shared/services';
import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import {
  createDatabaseRowTaskInteropLink,
  createTaskIdentity,
  encodeTaskAncestorIdentities,
  insertPositionToIndex,
  parseTaskIdentity,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';
import {
  type DatabaseFlags,
  DataSourceBase,
  type DataViewDataType,
  type PropertyMetaConfig,
  type TypeInstance,
  type ViewManager,
  ViewManagerBase,
  type ViewMeta,
} from '@blocksuite/data-view';
import { propertyPresets } from '@blocksuite/data-view/property-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import type { EditorHost } from '@blocksuite/std';
import { type BlockModel, nanoid, Text } from '@blocksuite/store';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';
import { format } from 'date-fns/format';
import { isValid } from 'date-fns/isValid';
import { parse } from 'date-fns/parse';

import { getIcon } from './block-icons.js';
import {
  databaseBlockProperties,
  databasePropertyConverts,
} from './properties/index.js';
import {
  addProperty,
  copyCellsByProperty,
  deleteRows,
  deleteView,
  duplicateView,
  getCell,
  getProperty,
  moveViewTo,
  updateCell,
  updateCells,
  updateProperty,
  updateView,
} from './utils/block-utils.js';
import {
  databaseBlockViewConverts,
  databaseBlockViewMap,
  databaseBlockViews,
} from './views/index.js';

const TASK_INTEROP_COLUMN_ID = '__affine_task_interop_link';
const READONLY_SYSTEM_COLUMN_NAMES = new Set([
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
]);

const DEFAULT_TASK_STATUS_INHERITANCE = {
  done: 'require-all-subtasks-complete',
  inProgress: 'start-when-any-subtask-starts',
  autoDemoteAutoDone: true,
  cascadeManualDoneToDescendants: true,
} as const;

const DEFAULT_TASK_WORKFLOW_DEFAULTS = TaskWorkflowDefaultsSchema.parse({});

type WorkflowStage = 'no_status' | 'todo' | 'in_progress' | 'review' | 'done';
type WorkflowSemantic = 'none' | 'todo' | 'in_progress' | 'done';
type TodoFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'progress';
type StatusProvenance = 'manual' | 'auto';
type ManualLock = 'none' | 'done_locked';
type StatusOption = {
  id: string;
  value: string;
  color?: string;
  semantic?: WorkflowSemantic;
};
export type TaskStatusInfo = {
  columnId: string;
  selectedOptionId?: string;
  selectedOption?: StatusOption;
  semantic: WorkflowSemantic;
  checked: boolean;
};

const TASK_STATUS_ENGINE_CONFIG = {
  stages: [
    {
      id: 'no_status',
      rank: 0,
      aliases: ['no status', 'none', ''],
    },
    {
      id: 'todo',
      rank: 1,
      aliases: ['todo', 'to do'],
    },
    {
      id: 'in_progress',
      rank: 2,
      aliases: ['in progress', 'in-progress', 'wip', 'doing'],
    },
    {
      id: 'review',
      rank: 3,
      aliases: ['review'],
    },
    {
      id: 'done',
      rank: 4,
      aliases: ['done', 'complete', 'completed'],
    },
  ],
  defaultStage: 'no_status',
  thresholds: {
    inProgressFloor: 'in_progress',
  },
} as const;

const STAGE_RANK: Record<WorkflowStage, number> = {
  no_status: TASK_STATUS_ENGINE_CONFIG.stages.find(v => v.id === 'no_status')
    ?.rank as number,
  todo: TASK_STATUS_ENGINE_CONFIG.stages.find(v => v.id === 'todo')
    ?.rank as number,
  in_progress: TASK_STATUS_ENGINE_CONFIG.stages.find(
    v => v.id === 'in_progress'
  )?.rank as number,
  review: TASK_STATUS_ENGINE_CONFIG.stages.find(v => v.id === 'review')
    ?.rank as number,
  done: TASK_STATUS_ENGINE_CONFIG.stages.find(v => v.id === 'done')
    ?.rank as number,
};

const STAGE_BY_ALIAS = new Map<string, WorkflowStage>(
  TASK_STATUS_ENGINE_CONFIG.stages.flatMap(stage =>
    stage.aliases.map(alias => [alias, stage.id as WorkflowStage])
  )
);

const normalizeWorkflowLabel = (value: string) => value.trim().toLowerCase();

const normalizeWorkflowSemantic = (value: string): WorkflowSemantic | null => {
  const normalized = normalizeWorkflowLabel(value).replaceAll('-', '_');
  if (normalized === 'none' || normalized === 'no_status') {
    return 'none';
  }
  if (normalized === 'todo' || normalized === 'to_do') {
    return 'todo';
  }
  if (
    normalized === 'in_progress' ||
    normalized === 'inprogress' ||
    normalized === 'wip'
  ) {
    return 'in_progress';
  }
  if (
    normalized === 'done' ||
    normalized === 'complete' ||
    normalized === 'completed'
  ) {
    return 'done';
  }
  return null;
};

const semanticToStage = (semantic?: WorkflowSemantic): WorkflowStage | null => {
  if (!semantic || semantic === 'none') {
    return semantic === 'none' ? 'no_status' : null;
  }
  return semantic;
};

const resolveWorkflowStageFromLabel = (label: string): WorkflowStage | null =>
  STAGE_BY_ALIAS.get(normalizeWorkflowLabel(label)) ?? null;

const inferWorkflowSemanticFromLabel = (label: string): WorkflowSemantic => {
  const stage = resolveWorkflowStageFromLabel(label);
  if (stage === 'review') {
    return 'in_progress';
  }
  if (stage === 'todo' || stage === 'in_progress' || stage === 'done') {
    return stage;
  }
  return 'none';
};

const parseWorkflowColumn = (value: string) => {
  const [labelPart = '', semanticPart] = value.split(':');
  const label = labelPart.trim();
  const semantic = semanticPart
    ? (normalizeWorkflowSemantic(semanticPart) ??
      inferWorkflowSemanticFromLabel(label))
    : inferWorkflowSemanticFromLabel(label);
  return { label, semantic };
};

const toWorkflowOptionId = (label: string, semantic: WorkflowSemantic) => {
  const normalizedLabel = normalizeWorkflowLabel(label);
  if (semantic === 'todo' && ['todo', 'to do'].includes(normalizedLabel)) {
    return 'todo';
  }
  if (
    semantic === 'in_progress' &&
    ['in progress', 'in-progress', 'wip', 'doing'].includes(normalizedLabel)
  ) {
    return 'in_progress';
  }
  if (
    semantic === 'done' &&
    ['done', 'complete', 'completed'].includes(normalizedLabel)
  ) {
    return 'done';
  }
  const suffix = normalizedLabel
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  return suffix ? `workflow_${suffix}` : `workflow_${semantic}`;
};

const resolveWorkflowStageFromOptionId = (id: string): WorkflowStage | null => {
  if (id === 'not_done') {
    return 'todo';
  }
  return resolveWorkflowStageFromLabel(id);
};

const getStatusOptionColor = (stage: WorkflowStage | null) => {
  switch (stage) {
    case 'done':
      return 'var(--affine-tag-green)';
    case 'in_progress':
      return 'var(--affine-tag-blue)';
    case 'review':
      return 'var(--affine-tag-purple)';
    case 'todo':
    default:
      return 'var(--affine-tag-yellow)';
  }
};

export const createTaskWorkflowStatusOptions = (
  taskWorkflowDefaults: ReturnType<typeof TaskWorkflowDefaultsSchema.parse>,
  doneTagLabel: string
) => {
  const columns = taskWorkflowDefaults.database.kanbanColumns
    .map(parseWorkflowColumn)
    .filter(column => column.label);
  const fallbackColumns = DEFAULT_TASK_WORKFLOW_DEFAULTS.database.kanbanColumns
    .map(parseWorkflowColumn)
    .filter(column => column.label);
  const seenIds = new Set<string>();
  const options: Array<StatusOption & { color: string }> = [];

  for (const { label, semantic } of columns.length > 0
    ? columns
    : fallbackColumns) {
    const stage = semanticToStage(semantic);
    const id = toWorkflowOptionId(label, semantic);
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    options.push({
      id,
      value: id === 'done' ? doneTagLabel || label || 'Done' : label,
      color: getStatusOptionColor(stage),
      semantic,
    });
  }

  if (!seenIds.has('done')) {
    options.push({
      id: 'done',
      value: doneTagLabel || 'Done',
      color: getStatusOptionColor('done'),
      semantic: 'done',
    });
  }

  return options;
};

export const parseTaskDateFieldValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const raw = value.trim();
  const normalized = /^\d{4}\/\d{2}\/\d{2}$/.test(raw)
    ? raw.replaceAll('/', '-')
    : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return undefined;
  }
  const date = parse(normalized, 'yyyy-MM-dd', new Date());
  if (!isValid(date)) {
    return undefined;
  }
  return format(date, 'yyyy-MM-dd') === normalized ? +date : undefined;
};

export type TaskIdentityRowLookup =
  | { status: 'unique'; rowId: string }
  | { status: 'missing' }
  | { status: 'duplicate'; rowIds: [string, string] };

type SpacialProperty = {
  valueSet: (rowId: string, propertyId: string, value: unknown) => void;
  valueGet: (rowId: string, propertyId: string) => unknown;
};

export class DatabaseBlockDataSource extends DataSourceBase {
  private readonly _pendingHierarchyLevelByRowId = new Map<string, number>();
  private readonly _pendingHierarchyMoveByRowId = new Map<
    string,
    { movedRowIds: string[]; oldRootLevel: number }
  >();

  setPendingHierarchyLevel(rowId: string, level: number) {
    if (!Number.isFinite(level)) {
      this._pendingHierarchyLevelByRowId.delete(rowId);
      return;
    }
    this._pendingHierarchyLevelByRowId.set(
      rowId,
      Math.max(0, Math.floor(level))
    );
  }

  private parseHierarchyLevel(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.floor(parsed));
      }
    }
    return 0;
  }

  getTaskStatusInheritance() {
    return {
      done:
        this._model.props.taskStatusInheritance?.done ??
        DEFAULT_TASK_STATUS_INHERITANCE.done,
      inProgress:
        this._model.props.taskStatusInheritance?.inProgress ??
        DEFAULT_TASK_STATUS_INHERITANCE.inProgress,
      autoDemoteAutoDone:
        this._model.props.taskStatusInheritance?.autoDemoteAutoDone ??
        DEFAULT_TASK_STATUS_INHERITANCE.autoDemoteAutoDone,
      cascadeManualDoneToDescendants:
        this._model.props.taskStatusInheritance
          ?.cascadeManualDoneToDescendants ??
        DEFAULT_TASK_STATUS_INHERITANCE.cascadeManualDoneToDescendants,
    };
  }

  setTaskStatusInheritance(next: {
    done?: 'require-all-subtasks-complete' | 'disabled';
    inProgress?: 'start-when-any-subtask-starts' | 'disabled';
    autoDemoteAutoDone?: boolean;
    cascadeManualDoneToDescendants?: boolean;
  }) {
    const current = this.getTaskStatusInheritance();
    const resolved = {
      done: next.done ?? current.done,
      inProgress: next.inProgress ?? current.inProgress,
      autoDemoteAutoDone: next.autoDemoteAutoDone ?? current.autoDemoteAutoDone,
      cascadeManualDoneToDescendants:
        next.cascadeManualDoneToDescendants ??
        current.cascadeManualDoneToDescendants,
    };
    this.doc.captureSync();
    this._model.store.transact(() => {
      this._model.props.taskStatusInheritance = resolved;
      this.recomputeAllParentStatusesFromChildren();
    });
  }

  getTaskStatusColumn() {
    return this.getTaskStatusColumns()[0];
  }

  getTaskStatusInfo(rowId: string, propertyId?: string): TaskStatusInfo | null {
    const column = propertyId
      ? this._model.props.columns.find(
          column => column.id === propertyId && this.isTaskStatusColumn(column)
        )
      : this.getTaskStatusColumn();
    if (!column) {
      return null;
    }

    const options = this.getTaskStatusOptions(column);
    const optionById = new Map(options.map(option => [option.id, option]));
    const selectedOptionId = this.resolveSelectStatusValue(
      getCell(this._model, rowId, column.id)?.value
    );
    const selectedOption = selectedOptionId
      ? optionById.get(selectedOptionId)
      : undefined;
    const semantic = this.resolveWorkflowSemanticFromOption(selectedOption);

    return {
      columnId: column.id,
      selectedOptionId,
      selectedOption,
      semantic,
      checked: semantic === 'done',
    };
  }

  getTaskStatusTargetOption(
    semantic: WorkflowSemantic,
    propertyId?: string
  ): StatusOption | undefined {
    const column = propertyId
      ? this._model.props.columns.find(
          column => column.id === propertyId && this.isTaskStatusColumn(column)
        )
      : this.getTaskStatusColumn();
    if (!column) {
      return undefined;
    }
    const targetStage = semanticToStage(semantic);
    return this.getTaskStatusOptions(column).find(
      option => this.resolveWorkflowStageFromOption(option) === targetStage
    );
  }

  setTaskStatusChecked(rowId: string, checked: boolean, propertyId?: string) {
    const target = this.getTaskStatusTargetOption(
      checked ? 'done' : 'todo',
      propertyId
    );
    if (!target) {
      return;
    }
    const column = propertyId
      ? this._model.props.columns.find(
          column => column.id === propertyId && this.isTaskStatusColumn(column)
        )
      : this.getTaskStatusColumn();
    if (!column) {
      return;
    }
    this.cellValueChange(rowId, column.id, target.id);
  }

  private normalizeStatusLabel(value: string) {
    return value.trim().toLowerCase();
  }

  private getTaskStatusOptions(column: ColumnDataType): StatusOption[] {
    return ((column.data as { options?: StatusOption[] })?.options ??
      []) as StatusOption[];
  }

  private resolveWorkflowSemanticFromOption(
    option?: StatusOption
  ): WorkflowSemantic {
    const stage = this.resolveWorkflowStageFromOption(option);
    if (stage === 'done' || stage === 'todo' || stage === 'in_progress') {
      return stage;
    }
    if (stage === 'review') {
      return 'in_progress';
    }
    return 'none';
  }

  private resolveWorkflowStage(label: string): WorkflowStage | null {
    const normalized = this.normalizeStatusLabel(label);
    return STAGE_BY_ALIAS.get(normalized) ?? null;
  }

  private resolveWorkflowStageFromOption(option?: {
    id: string;
    value: string;
    semantic?: WorkflowSemantic;
  }): WorkflowStage | null {
    if (!option) {
      return null;
    }
    const semanticStage = semanticToStage(option.semantic);
    if (semanticStage) {
      return semanticStage;
    }
    const idStage = resolveWorkflowStageFromOptionId(option.id);
    return idStage ?? this.resolveWorkflowStage(option.value);
  }

  private isTaskStatusColumn(column: ColumnDataType) {
    if (column.type !== 'select') {
      return false;
    }
    const options = ((
      column.data as {
        options?: Array<{ id: string; value: string }>;
      }
    ).options ?? []) as Array<{ id: string; value: string }>;
    return options.some(option => this.resolveWorkflowStageFromOption(option));
  }

  private getRowStatusState(rowId: string): {
    provenance: StatusProvenance;
    manualLock: ManualLock;
  } {
    const state = this._model.props.taskStatusState?.[rowId];
    if (!state) {
      return { provenance: 'manual', manualLock: 'none' };
    }
    return {
      provenance: state.provenance,
      manualLock: state.manualLock,
    };
  }

  private setRowStatusState(
    rowId: string,
    next: Partial<{ provenance: StatusProvenance; manualLock: ManualLock }>
  ) {
    const current = this.getRowStatusState(rowId);
    const merged = {
      provenance: next.provenance ?? current.provenance,
      manualLock: next.manualLock ?? current.manualLock,
    };
    this._model.props.taskStatusState = {
      ...this._model.props.taskStatusState,
      [rowId]: merged,
    };
  }

  private resolveSelectStatusValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const option = value as { id?: unknown };
      return typeof option.id === 'string' ? option.id : undefined;
    }
    if (Array.isArray(value)) {
      const first = value[0] as { id?: string } | undefined;
      return typeof first?.id === 'string' ? first.id : undefined;
    }
    return undefined;
  }

  private getTaskStatusColumns() {
    return this._model.props.columns.filter(column =>
      this.isTaskStatusColumn(column)
    );
  }

  private recomputeAllParentStatusesFromChildren() {
    for (const column of this.getTaskStatusColumns()) {
      for (const row of this._model.children) {
        this.recomputeParentStatusesFromChildren(row.id, column.id, 'auto');
      }
    }
  }

  private getChildrenByParentRowId() {
    const parentColumn = this._model.props.columns.find(
      column => column.name === TASK_PARENT_IDENTIFIER_COLUMN_NAME
    );
    if (!parentColumn) {
      return null;
    }

    const rowIds = this._model.children.map(child => child.id);
    const identityByRowId = new Map(
      rowIds.map(id => [
        id,
        createTaskIdentity({ docId: this.doc.id, blockId: id }),
      ])
    );
    const rowIdByIdentity = new Map(
      [...identityByRowId.entries()].map(([id, identity]) => [identity, id])
    );
    const childrenByParent = new Map<string, string[]>();
    for (const id of rowIds) {
      const parentCell = getCell(this._model, id, parentColumn.id)?.value;
      const parentIdentity =
        typeof parentCell === 'string'
          ? parentCell
          : parentCell instanceof Text
            ? parentCell.toString()
            : undefined;
      if (!parentIdentity) {
        continue;
      }
      const parsed = parseTaskIdentity(parentIdentity);
      if (!parsed || parsed.docId !== this.doc.id) {
        continue;
      }
      const parentRowId = rowIdByIdentity.get(parentIdentity);
      if (!parentRowId) {
        continue;
      }
      const list = childrenByParent.get(parentRowId) ?? [];
      list.push(id);
      childrenByParent.set(parentRowId, list);
    }

    return childrenByParent;
  }

  private cascadeStatusToDescendants(
    rowId: string,
    propertyId: string,
    targetOption: StatusOption,
    provenance: StatusProvenance,
    manualLock: ManualLock
  ) {
    const childrenByParent = this.getChildrenByParentRowId();
    if (!childrenByParent) {
      return;
    }

    const descendants: string[] = [];
    const queue = [...(childrenByParent.get(rowId) ?? [])];
    const visitedDescendants = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visitedDescendants.has(current)) {
        continue;
      }
      visitedDescendants.add(current);
      descendants.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }

    const statusColumn = this._model.props.columns.find(
      column => column.id === propertyId && column.type === 'select'
    );
    const options = ((
      statusColumn?.data as { options?: StatusOption[] } | undefined
    )?.options ?? []) as StatusOption[];
    const optionById = new Map(options.map(option => [option.id, option]));
    const targetStage = this.resolveWorkflowStageFromOption(targetOption);

    const cascadeUpdates: Record<string, unknown> = {};
    for (const descendantId of descendants) {
      const currentRaw = getCell(this._model, descendantId, propertyId)?.value;
      const currentId = this.resolveSelectStatusValue(currentRaw);
      if (currentId === targetOption.id) {
        continue;
      }
      const currentStage = currentId
        ? this.resolveWorkflowStageFromOption(optionById.get(currentId))
        : 'no_status';
      const currentState = this.getRowStatusState(descendantId);
      if (
        targetStage === 'todo' &&
        currentStage === 'done' &&
        currentState.provenance === 'manual' &&
        currentState.manualLock === 'done_locked'
      ) {
        continue;
      }
      cascadeUpdates[descendantId] = targetOption.id;
      this.setRowStatusState(descendantId, {
        provenance,
        manualLock,
      });
    }
    if (Object.keys(cascadeUpdates).length > 0) {
      updateCells(this._model, propertyId, cascadeUpdates);
    }
  }

  private recomputeParentStatusesFromChildren(
    changedRowId: string,
    propertyId: string,
    source: StatusProvenance = 'manual',
    context?: {
      descendantDemotedFromDone?: boolean;
    }
  ) {
    const statusColumn = this._model.props.columns.find(
      column => column.id === propertyId && column.type === 'select'
    );
    if (!statusColumn) {
      return;
    }
    if (!this.isTaskStatusColumn(statusColumn)) {
      return;
    }
    const options = ((
      statusColumn.data as { options?: Array<{ id: string; value: string }> }
    ).options ?? []) as Array<{ id: string; value: string }>;
    const optionById = new Map(options.map(option => [option.id, option]));

    const stageToOption = new Map<
      WorkflowStage,
      { id: string; value: string }
    >();
    for (const option of options) {
      const stage = this.resolveWorkflowStageFromOption(option);
      if (stage && !stageToOption.has(stage)) {
        stageToOption.set(stage, option);
      }
    }
    if (stageToOption.size === 0) {
      return;
    }

    const parentColumn = this._model.props.columns.find(
      column => column.name === TASK_PARENT_IDENTIFIER_COLUMN_NAME
    );
    if (!parentColumn) {
      return;
    }

    const rowIds = this._model.children.map(child => child.id);
    const taskIdentityByRowId = new Map(
      rowIds.map(rowId => [
        rowId,
        createTaskIdentity({
          docId: this.doc.id,
          blockId: rowId,
        }),
      ])
    );
    const rowIdByIdentity = new Map(
      [...taskIdentityByRowId.entries()].map(([rowId, identity]) => [
        identity,
        rowId,
      ])
    );

    const childrenByParent = new Map<string, string[]>();
    for (const rowId of rowIds) {
      const parentCell = getCell(this._model, rowId, parentColumn.id)?.value;
      const parentIdentity =
        typeof parentCell === 'string'
          ? parentCell
          : parentCell instanceof Text
            ? parentCell.toString()
            : undefined;
      if (!parentIdentity) {
        continue;
      }
      const parsed = parseTaskIdentity(parentIdentity);
      if (!parsed || parsed.docId !== this.doc.id) {
        continue;
      }
      const parentRowId = rowIdByIdentity.get(parentIdentity);
      if (!parentRowId) {
        continue;
      }
      const list = childrenByParent.get(parentRowId) ?? [];
      list.push(rowId);
      childrenByParent.set(parentRowId, list);
    }

    const inheritance = this.getTaskStatusInheritance();
    if (
      inheritance.done === 'disabled' &&
      inheritance.inProgress === 'disabled'
    ) {
      return;
    }
    const updates: Record<string, unknown> = {};

    const getRowStage = (rowId: string): WorkflowStage => {
      const pending = updates[rowId];
      const raw = pending ?? getCell(this._model, rowId, propertyId)?.value;
      const selectedId = this.resolveSelectStatusValue(raw);
      if (!selectedId) {
        return 'no_status';
      }
      const option = optionById.get(selectedId);
      if (!option) {
        return 'no_status';
      }
      return this.resolveWorkflowStageFromOption(option) ?? 'no_status';
    };

    const getDescendantStages = (rowId: string): WorkflowStage[] => {
      const stages: WorkflowStage[] = [];
      const queue = [...(childrenByParent.get(rowId) ?? [])];
      const visitedDescendants = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visitedDescendants.has(current)) {
          continue;
        }
        visitedDescendants.add(current);
        stages.push(getRowStage(current));
        queue.push(...(childrenByParent.get(current) ?? []));
      }
      return stages;
    };

    let currentParentRowId = rowIdByIdentity.get(
      (() => {
        const parentCell = getCell(
          this._model,
          changedRowId,
          parentColumn.id
        )?.value;
        return typeof parentCell === 'string'
          ? parentCell
          : parentCell instanceof Text
            ? parentCell.toString()
            : '';
      })()
    );

    const visitedParentRowIds = new Set<string>();
    while (currentParentRowId && !visitedParentRowIds.has(currentParentRowId)) {
      visitedParentRowIds.add(currentParentRowId);
      const children = childrenByParent.get(currentParentRowId) ?? [];
      if (children.length === 0) {
        break;
      }
      const descendantStages = getDescendantStages(currentParentRowId);

      let targetStage: WorkflowStage | null = null;
      const allDone =
        descendantStages.length > 0 &&
        descendantStages.every(stage => stage === 'done');
      const anyInProgressOrDone = descendantStages.some(
        stage =>
          STAGE_RANK[stage] >=
          STAGE_RANK[TASK_STATUS_ENGINE_CONFIG.thresholds.inProgressFloor]
      );
      const anyTodo = descendantStages.some(stage => stage === 'todo');

      if (inheritance.done === 'require-all-subtasks-complete' && allDone) {
        targetStage = 'done';
      } else if (
        inheritance.inProgress === 'start-when-any-subtask-starts' &&
        anyInProgressOrDone
      ) {
        targetStage = 'in_progress';
      } else if (anyTodo) {
        targetStage = 'todo';
      } else {
        targetStage = 'no_status';
      }

      const option = targetStage ? stageToOption.get(targetStage) : undefined;
      if (option) {
        const currentStage = getRowStage(currentParentRowId);
        const currentRaw =
          updates[currentParentRowId] ??
          getCell(this._model, currentParentRowId, propertyId)?.value;
        const currentId = this.resolveSelectStatusValue(currentRaw);
        const parentState = this.getRowStatusState(currentParentRowId);
        const wouldDemote =
          currentStage && targetStage
            ? STAGE_RANK[targetStage] < STAGE_RANK[currentStage]
            : false;
        const blockAutoDemotionFromDone =
          currentStage === 'done' &&
          wouldDemote &&
          parentState.manualLock === 'done_locked' &&
          parentState.provenance === 'manual' &&
          source === 'auto';

        if (
          context?.descendantDemotedFromDone &&
          source === 'auto' &&
          inheritance.autoDemoteAutoDone &&
          currentStage === 'done' &&
          !blockAutoDemotionFromDone
        ) {
          const demotionOption = option ?? stageToOption.get('in_progress');
          if (demotionOption && currentId !== demotionOption.id) {
            updates[currentParentRowId] = demotionOption.id;
            this.setRowStatusState(currentParentRowId, {
              provenance: 'auto',
              manualLock: 'none',
            });
          }
        } else if (!blockAutoDemotionFromDone && currentId !== option.id) {
          updates[currentParentRowId] = option.id;
          this.setRowStatusState(currentParentRowId, {
            provenance: 'auto',
            manualLock: 'none',
          });
        } else if (
          source === 'auto' &&
          targetStage === 'done' &&
          currentId === option.id &&
          allDone
        ) {
          this.setRowStatusState(currentParentRowId, {
            provenance: 'auto',
            manualLock: 'none',
          });
        }
      }

      const currentParentCell = getCell(
        this._model,
        currentParentRowId,
        parentColumn.id
      )?.value;
      const currentParentIdentity =
        typeof currentParentCell === 'string'
          ? currentParentCell
          : currentParentCell instanceof Text
            ? currentParentCell.toString()
            : undefined;
      currentParentRowId = currentParentIdentity
        ? rowIdByIdentity.get(currentParentIdentity)
        : undefined;
    }

    if (Object.keys(updates).length > 0) {
      updateCells(this._model, propertyId, updates);
    }
  }

  private isReadonlySystemColumn(propertyId: string) {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return false;
    }
    return READONLY_SYSTEM_COLUMN_NAMES.has(result.column.name);
  }

  findRowByTaskIdentity(taskIdentity: string): TaskIdentityRowLookup {
    let match: string | null = null;
    for (const rowId of this.rows$.value) {
      const link = this.getTaskInteropLink(rowId);
      if (link?.taskIdentity === taskIdentity) {
        if (match && match !== rowId) {
          console.warn(
            '[task-interop] Duplicate task identity found in database rows',
            {
              taskIdentity,
              rowA: match,
              rowB: rowId,
            }
          );
          return { status: 'duplicate', rowIds: [match, rowId] };
        }
        match = rowId;
      }
    }

    if (!match) {
      return { status: 'missing' };
    }
    return { status: 'unique', rowId: match };
  }

  findRowIdByTaskIdentity(taskIdentity: string) {
    const result = this.findRowByTaskIdentity(taskIdentity);
    return result.status === 'unique' ? result.rowId : null;
  }

  getTaskInteropLink(rowId: string) {
    const stored = this.cellValueGet(rowId, TASK_INTEROP_COLUMN_ID);
    if (stored && typeof stored === 'object') {
      return stored as ReturnType<typeof createDatabaseRowTaskInteropLink>;
    }

    const model = this.getModelById(rowId);
    if (!model) {
      return null;
    }

    return createDatabaseRowTaskInteropLink({
      docId: this.doc.id,
      blockId: model.id,
      databaseId: this._model.id,
      sourceFlavor: model.flavour,
    });
  }

  setTaskInteropLink(
    rowId: string,
    link: ReturnType<typeof createDatabaseRowTaskInteropLink>
  ) {
    this._runCapture();
    updateCell(this._model, rowId, {
      columnId: TASK_INTEROP_COLUMN_ID,
      value: link,
    });
  }

  override get parentProvider() {
    return this._model.store.provider;
  }

  spacialProperties: Record<string, SpacialProperty> = {
    'created-time': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as ParagraphBlockModel;
        if (!model) {
          return null;
        }
        return model.props['meta:createdAt'];
      },
    },
    'created-by': {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId) as
          | ParagraphBlockModel
          | undefined;
        return model ? model.props['meta:createdBy'] : null;
      },
    },
    type: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return getIcon(model);
      },
    },
    title: {
      valueSet: () => {},
      valueGet: (rowId: string) => {
        const model = this.getModelById(rowId);
        if (!model) {
          return;
        }
        return model.text;
      },
    },
    [TASK_INTEROP_COLUMN_ID]: {
      valueSet: (rowId: string, propertyId: string, value: unknown) => {
        updateCell(this._model, rowId, {
          columnId: propertyId,
          value,
        });
      },
      valueGet: (rowId: string, propertyId: string) => {
        return getCell(this._model, rowId, propertyId)?.value;
      },
    },
  };

  isSpacialProperty(propertyType: string): boolean {
    return this.spacialProperties[propertyType] !== undefined;
  }

  spacialValueGet(
    rowId: string,
    propertyId: string,
    propertyType: string
  ): unknown {
    return this.spacialProperties[propertyType]?.valueGet(rowId, propertyId);
  }

  static externalProperties = signal<PropertyMetaConfig[]>([]);
  static propertiesList = computed(() => {
    return [
      ...Object.values(databaseBlockProperties),
      ...this.externalProperties.value,
    ];
  });
  static propertiesMap = computed(() => {
    return Object.fromEntries(
      this.propertiesList.value.map(v => [v.type, v as PropertyMetaConfig])
    );
  });

  private _batch = 0;

  private readonly _model: DatabaseBlockModel;

  override featureFlags$: ReadonlySignal<DatabaseFlags> = computed(() => {
    const featureFlagService = this.doc.get(FeatureFlagService);
    const enableTableVirtualScroll = featureFlagService.getFlag(
      'enable_table_virtual_scroll'
    );
    return {
      enable_table_virtual_scroll: enableTableVirtualScroll ?? false,
    };
  });

  properties$: ReadonlySignal<string[]> = computed(() => {
    const fixedPropertiesSet = new Set(this.fixedProperties$.value);
    const properties: string[] = [];
    this._model.props.columns$.value.forEach(column => {
      if (fixedPropertiesSet.has(column.type)) {
        fixedPropertiesSet.delete(column.type);
      }
      properties.push(column.id);
    });

    const result = [...fixedPropertiesSet, ...properties];
    return result;
  });

  readonly$: ReadonlySignal<boolean> = computed(() => {
    return (
      this._model.store.readonly ||
      (IS_MOBILE &&
        !this._model.store.provider
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing'))
    );
  });

  rows$: ReadonlySignal<string[]> = computed(() => {
    return this._model.children.map(v => v.id);
  });

  viewConverts = databaseBlockViewConverts;

  viewDataList$: ReadonlySignal<DataViewDataType[]> = computed(() => {
    return this._model.props.views$.value as DataViewDataType[];
  });

  override viewManager: ViewManager = new ViewManagerBase(this);

  viewMetas = databaseBlockViews;

  get doc() {
    return this._model.store;
  }

  allPropertyMetas$ = computed<PropertyMetaConfig<any, any, any, any>[]>(() => {
    return DatabaseBlockDataSource.propertiesList.value;
  });

  propertyMetas$ = computed<PropertyMetaConfig[]>(() => {
    return this.allPropertyMetas$.value.filter(
      v => !v.config.fixed && !v.config.hide
    );
  });

  constructor(
    model: DatabaseBlockModel,
    init?: (dataSource: DatabaseBlockDataSource) => void
  ) {
    super();
    this._model = model; // ensure invariants first
    init?.(this); // then allow external initialisation
  }

  private _runCapture() {
    if (this._batch) {
      return;
    }

    this._batch = requestAnimationFrame(() => {
      this.doc.captureSync();
      this._batch = 0;
    });
  }

  private getModelById(rowId: string): BlockModel | undefined {
    return this._model.children[this._model.childMap.value.get(rowId) ?? -1];
  }

  private newPropertyName(prefix = 'Column'): string {
    let i = 1;
    const hasSameName = (name: string) => {
      return this._model.props.columns$.value.some(
        column => column.name === name
      );
    };
    while (true) {
      let name = i === 1 ? prefix : `${prefix} ${i}`;
      if (!hasSameName(name)) {
        return name;
      }
      i++;
    }
  }

  cellValueChange(rowId: string, propertyId: string, value: unknown): void {
    if (this.isReadonlySystemColumn(propertyId)) {
      return;
    }
    this._runCapture();

    const type = this.propertyTypeGet(propertyId);
    if (type == null) {
      return;
    }
    const update = this.propertyMetaGet(type)?.config.rawValue.setValue;
    const old = this.cellValueGet(rowId, propertyId);
    const updateFn =
      update ??
      (({ setValue, newValue }) => {
        setValue(newValue);
      });
    updateFn({
      value: old,
      data: this.propertyDataGet(propertyId),
      dataSource: this,
      newValue: value,
      setValue: newValue => {
        if (this._model.props.columns$.value.some(v => v.id === propertyId)) {
          updateCell(this._model, rowId, {
            columnId: propertyId,
            value: newValue,
          });
        }
      },
    });

    this._model.store.transact(() => {
      let descendantDemotedFromDone = false;

      const statusColumn = this._model.props.columns.find(
        column => column.id === propertyId && column.type === 'select'
      );
      if (statusColumn && this.isTaskStatusColumn(statusColumn)) {
        const options = ((statusColumn.data as { options?: StatusOption[] })
          .options ?? []) as StatusOption[];
        const optionById = new Map(options.map(option => [option.id, option]));
        const currentId = this.resolveSelectStatusValue(old);
        const currentStage = currentId
          ? this.resolveWorkflowStageFromOption(optionById.get(currentId))
          : 'no_status';
        const nextId = this.resolveSelectStatusValue(value);
        const nextOption = nextId ? optionById.get(nextId) : undefined;
        const nextStage = nextOption
          ? this.resolveWorkflowStageFromOption(nextOption)
          : 'no_status';
        const wasDone = currentStage === 'done';
        const isDone = nextStage === 'done';
        descendantDemotedFromDone = wasDone && !isDone;
        const manualLock: ManualLock =
          isDone || wasDone ? 'done_locked' : 'none';
        this.setRowStatusState(rowId, {
          provenance: 'manual',
          manualLock,
        });

        if (nextStage === 'todo') {
          const todoOption = options.find(
            option => this.resolveWorkflowStageFromOption(option) === 'todo'
          );
          if (todoOption) {
            this.cascadeStatusToDescendants(
              rowId,
              propertyId,
              todoOption,
              'auto',
              'none'
            );
          }
        } else if (
          nextStage === 'done' &&
          nextOption &&
          this.getTaskStatusInheritance().cascadeManualDoneToDescendants
        ) {
          this.cascadeStatusToDescendants(
            rowId,
            propertyId,
            nextOption,
            'auto',
            'done_locked'
          );
        }
      }

      this.recomputeParentStatusesFromChildren(rowId, propertyId, 'auto', {
        descendantDemotedFromDone,
      });
      if (descendantDemotedFromDone) {
        this.recomputeAllParentStatusesFromChildren();
      }
    });
  }

  cellValueGet(rowId: string, propertyId: string): unknown {
    if (this.isSpacialProperty(propertyId)) {
      return this.spacialValueGet(rowId, propertyId, propertyId);
    }
    const type = this.propertyTypeGet(propertyId);
    if (!type) {
      return;
    }
    if (this.isSpacialProperty(type)) {
      return this.spacialValueGet(rowId, propertyId, type);
    }
    const meta = this.propertyMetaGet(type);
    if (!meta) {
      return;
    }
    const rawValue =
      getCell(this._model, rowId, propertyId)?.value ??
      meta.config.rawValue.default();
    const schema = meta.config.rawValue.schema;
    const result = schema.safeParse(rawValue);
    if (result.success) {
      return result.data;
    }
    return;
  }

  propertyAdd(
    insertToPosition: InsertToPosition,
    ops?: {
      type?: string;
      name?: string;
    }
  ): string | undefined {
    this.doc.captureSync();
    const { type, name } = ops ?? {};
    const property = this.propertyMetaGet(
      type ?? propertyPresets.multiSelectPropertyConfig.type
    );
    if (!property) {
      return;
    }
    const result = addProperty(
      this._model,
      insertToPosition,
      property.create(this.newPropertyName(name))
    );
    return result;
  }

  protected override getNormalPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const index = this._model.props.columns$.value.findIndex(
      v => v.id === propertyId
    );
    if (index >= 0) {
      const column = this._model.props.columns$.value[index];
      if (!column) {
        return;
      }
      return {
        column,
        index,
      };
    }
    return;
  }

  private getPropertyAndIndex(propertyId: string):
    | {
        column: ColumnDataType<Record<string, unknown>>;
        index: number;
      }
    | undefined {
    const result = this.getNormalPropertyAndIndex(propertyId);
    if (result) {
      return result;
    }
    if (this.isFixedProperty(propertyId)) {
      const meta = this.propertyMetaGet(propertyId);
      if (!meta) {
        return;
      }
      const defaultData = meta.config.fixed?.defaultData ?? {};
      return {
        column: {
          data: defaultData,
          id: propertyId,
          type: propertyId,
          name: meta.config.name,
        },
        index: -1,
      };
    }
    return undefined;
  }

  private updateProperty(id: string, updater: ColumnUpdater) {
    const result = this.getPropertyAndIndex(id);
    if (!result) {
      return;
    }
    const { column: prevColumn, index } = result;
    this._model.store.transact(() => {
      if (index >= 0) {
        const result = updater(prevColumn);
        this._model.props.columns[index] = { ...prevColumn, ...result };
      } else {
        const result = updater(prevColumn);
        this._model.props.columns = [
          ...this._model.props.columns,
          { ...prevColumn, ...result },
        ];
      }
    });
    return id;
  }

  propertyDataGet(propertyId: string): Record<string, unknown> {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return {};
    }
    return result.column.data;
  }

  propertyDataSet(propertyId: string, data: Record<string, unknown>): void {
    this._runCapture();
    this.updateProperty(propertyId, () => ({ data }));
  }

  propertyDataTypeGet(propertyId: string): TypeInstance | undefined {
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    const { column } = result;
    const meta = this.propertyMetaGet(column.type);
    if (!meta) {
      return;
    }
    return meta.config?.jsonValue.type({
      data: column.data,
      dataSource: this,
    });
  }

  propertyDelete(id: string): void {
    if (this.isFixedProperty(id)) {
      return;
    }
    if (this.isReadonlySystemColumn(id)) {
      return;
    }
    this.doc.captureSync();
    const index = this._model.props.columns.findIndex(v => v.id === id);
    if (index < 0) return;

    this.doc.transact(() => {
      this._model.props.columns = this._model.props.columns.filter(
        (_, i) => i !== index
      );
    });
  }

  propertyDuplicate(propertyId: string): string | undefined {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    this.doc.captureSync();
    const currentSchema = getProperty(this._model, propertyId);
    if (!currentSchema) {
      return;
    }
    const { id: copyId, ...nonIdProps } = currentSchema;
    const names = new Set(this._model.props.columns$.value.map(v => v.name));
    let index = 1;
    while (names.has(`${nonIdProps.name}(${index})`)) {
      index++;
    }
    const schema = { ...nonIdProps, name: `${nonIdProps.name}(${index})` };
    const id = addProperty(
      this._model,
      {
        before: false,
        id: propertyId,
      },
      schema
    );
    copyCellsByProperty(this._model, copyId, id);
    return id;
  }

  propertyMetaGet(type: string): PropertyMetaConfig | undefined {
    return DatabaseBlockDataSource.propertiesMap.value[type];
  }

  propertyNameGet(propertyId: string): string {
    if (propertyId === 'type') {
      return 'Block Type';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return '';
    }
    return result.column.name;
  }

  propertyNameSet(propertyId: string, name: string): void {
    if (this.isReadonlySystemColumn(propertyId)) {
      return;
    }
    this.doc.captureSync();
    this.updateProperty(propertyId, () => ({ name }));
  }

  override propertyReadonlyGet(propertyId: string): boolean {
    if (propertyId === 'type') return true;
    if (this.isReadonlySystemColumn(propertyId)) return true;
    return false;
  }

  propertyTypeGet(propertyId: string): string | undefined {
    if (propertyId === 'type') {
      return 'image';
    }
    const result = this.getPropertyAndIndex(propertyId);
    if (!result) {
      return;
    }
    return result.column.type;
  }

  propertyTypeSet(propertyId: string, toType: string): void {
    if (this.isFixedProperty(propertyId)) {
      return;
    }
    if (this.isReadonlySystemColumn(propertyId)) {
      return;
    }
    const meta = this.propertyMetaGet(toType);
    if (!meta) {
      return;
    }
    const currentType = this.propertyTypeGet(propertyId);
    const currentData = this.propertyDataGet(propertyId);
    const rows = this.rows$.value;
    const currentCells = rows.map(rowId =>
      this.cellValueGet(rowId, propertyId)
    );
    const convertFunction = databasePropertyConverts.find(
      v => v.from === currentType && v.to === toType
    )?.convert;
    const result = convertFunction?.(
      currentData as any,

      currentCells as any
    ) ?? {
      property: meta.config.propertyData.default(),
      cells: currentCells.map(() => undefined),
    };
    this.doc.captureSync();
    updateProperty(this._model, propertyId, () => ({
      type: toType,
      data: result.property,
    }));
    const cells: Record<string, unknown> = {};
    currentCells.forEach((value, i) => {
      if (value != null || result.cells[i] != null) {
        const rowId = rows[i];
        if (rowId) {
          cells[rowId] = result.cells[i];
        }
      }
    });
    updateCells(this._model, propertyId, cells);
  }

  rowAdd(insertPosition: InsertToPosition | number): string {
    this.doc.captureSync();
    const index =
      typeof insertPosition === 'number'
        ? insertPosition
        : insertPositionToIndex(insertPosition, this._model.children);
    return this.doc.addBlock('affine:paragraph', {}, this._model.id, index);
  }

  rowDelete(ids: string[]): void {
    this.doc.captureSync();
    for (const id of ids) {
      const block = this.doc.getBlock(id);
      if (block) {
        this.doc.deleteBlock(block.model);
      }
    }
    deleteRows(this._model, ids);
  }

  rowMove(rowId: string, position: InsertToPosition): void {
    const model = this.doc.getModelById(rowId);
    if (model) {
      const levelColumn = this._model.props.columns.find(
        column => column.name === TASK_HIERARCHY_LEVEL_COLUMN_NAME
      );
      const children = this._model.children;
      const startIndex = children.findIndex(child => child.id === rowId);
      let movingModels = [model];
      let movedRowIds = [rowId];
      let oldRootLevel = 0;
      if (startIndex >= 0 && levelColumn) {
        const rootLevel = this.parseHierarchyLevel(
          getCell(this._model, rowId, levelColumn.id)?.value
        );
        oldRootLevel = rootLevel;
        const subtree = [children[startIndex]].filter(
          (v): v is typeof model => !!v
        );
        for (let i = startIndex + 1; i < children.length; i++) {
          const child = children[i];
          if (!child) break;
          const level = this.parseHierarchyLevel(
            getCell(this._model, child.id, levelColumn.id)?.value
          );
          if (level <= rootLevel) {
            break;
          }
          subtree.push(child as typeof model);
        }
        movingModels = subtree;
        movedRowIds = subtree.map(item => item.id);
      }

      const index = insertPositionToIndex(position, this._model.children);
      const target = this._model.children[index];
      if (target?.id === rowId) {
        return;
      }
      this._pendingHierarchyMoveByRowId.set(rowId, {
        movedRowIds,
        oldRootLevel,
      });
      this.doc.moveBlocks(movingModels, this._model, target);
      this.recomputeHierarchyMetadataAfterMove(rowId);
    }
  }

  private recomputeHierarchyMetadataAfterMove(movedRowId: string) {
    const levelColumn = this._model.props.columns.find(
      column => column.name === TASK_HIERARCHY_LEVEL_COLUMN_NAME
    );
    const parentColumn = this._model.props.columns.find(
      column => column.name === TASK_PARENT_IDENTIFIER_COLUMN_NAME
    );
    const ancestorColumn = this._model.props.columns.find(
      column => column.name === TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME
    );
    if (!levelColumn || !parentColumn || !ancestorColumn) {
      return;
    }

    const rowIds = this._model.children.map(child => child.id);
    const movedIndex = rowIds.indexOf(movedRowId);
    if (movedIndex < 0) {
      return;
    }

    const pendingMove = this._pendingHierarchyMoveByRowId.get(movedRowId);
    this._pendingHierarchyMoveByRowId.delete(movedRowId);

    const levels = rowIds.map(rowId =>
      this.parseHierarchyLevel(
        getCell(this._model, rowId, levelColumn.id)?.value
      )
    );
    const pendingLevel = this._pendingHierarchyLevelByRowId.get(movedRowId);
    this._pendingHierarchyLevelByRowId.delete(movedRowId);
    const nextRootLevel =
      pendingLevel != null && Number.isFinite(pendingLevel)
        ? pendingLevel
        : movedIndex > 0
          ? (levels[movedIndex - 1] ?? 0)
          : 0;
    levels[movedIndex] = nextRootLevel;

    if (pendingMove && pendingMove.movedRowIds.length > 0) {
      const movedSet = new Set(pendingMove.movedRowIds);
      const delta = nextRootLevel - pendingMove.oldRootLevel;
      if (delta !== 0) {
        for (let i = 0; i < rowIds.length; i++) {
          const id = rowIds[i];
          if (!id || !movedSet.has(id) || id === movedRowId) {
            continue;
          }
          const current = levels[i] ?? 0;
          levels[i] = Math.max(0, current + delta);
        }
      }
    }

    const levelCells: Record<string, unknown> = {};
    const parentCells: Record<string, unknown> = {};
    const ancestorCells: Record<string, unknown> = {};
    const stack: string[] = [];

    for (let i = 0; i < rowIds.length; i++) {
      const rowId = rowIds[i];
      if (!rowId) continue;
      const level = Math.max(0, levels[i] ?? 0);
      while (stack.length > level) {
        stack.pop();
      }

      levelCells[rowId] = level;
      const parentIdentity = stack.at(-1);
      parentCells[rowId] = parentIdentity
        ? new Text(parentIdentity)
        : undefined;
      ancestorCells[rowId] =
        stack.length > 0
          ? new Text(encodeTaskAncestorIdentities(stack))
          : undefined;

      const identity = createTaskIdentity({
        docId: this.doc.id,
        blockId: rowId,
      });
      stack[level] = identity;
      stack.length = level + 1;
    }

    updateCells(this._model, levelColumn.id, levelCells);
    updateCells(this._model, parentColumn.id, parentCells);
    updateCells(this._model, ancestorColumn.id, ancestorCells);
  }

  applyTaskHierarchyMutation(
    updatedLevels: Map<string, number>,
    updatedParents: Map<string, string | undefined>,
    updatedAncestors: Map<string, string>
  ) {
    const levelColumn = this._model.props.columns.find(
      column => column.name === TASK_HIERARCHY_LEVEL_COLUMN_NAME
    );
    const parentColumn = this._model.props.columns.find(
      column => column.name === TASK_PARENT_IDENTIFIER_COLUMN_NAME
    );
    const ancestorColumn = this._model.props.columns.find(
      column => column.name === TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME
    );
    if (!levelColumn || !parentColumn || !ancestorColumn) {
      return;
    }

    const levelCells: Record<string, unknown> = {};
    const parentCells: Record<string, unknown> = {};
    const ancestorCells: Record<string, unknown> = {};

    for (const rowId of this._model.children.map(child => child.id)) {
      const level = updatedLevels.get(rowId);
      if (level != null) {
        levelCells[rowId] = level;
      }

      if (updatedParents.has(rowId)) {
        const parent = updatedParents.get(rowId);
        parentCells[rowId] = parent ? new Text(parent) : undefined;
      }

      if (updatedAncestors.has(rowId)) {
        const ancestors = updatedAncestors.get(rowId) ?? '';
        ancestorCells[rowId] = ancestors ? new Text(ancestors) : undefined;
      }
    }

    updateCells(this._model, levelColumn.id, levelCells);
    updateCells(this._model, parentColumn.id, parentCells);
    updateCells(this._model, ancestorColumn.id, ancestorCells);
  }

  viewDataAdd(viewData: DataViewDataType): string {
    this._model.store.captureSync();
    this._model.store.transact(() => {
      this._model.props.views = [...this._model.props.views, viewData];
    });
    return viewData.id;
  }

  viewDataAddWithoutCapture(viewData: DataViewDataType): string {
    this._model.store.transact(() => {
      this._model.props.views = [...this._model.props.views, viewData];
    });
    return viewData.id;
  }

  viewDataDelete(viewId: string): void {
    this._model.store.captureSync();
    deleteView(this._model, viewId);
  }

  viewDataDuplicate(id: string): string {
    return duplicateView(this._model, id);
  }

  viewDataGet(viewId: string): DataViewDataType | undefined {
    return this.viewDataList$.value.find(data => data.id === viewId)!;
  }

  viewDataMoveTo(id: string, position: InsertToPosition): void {
    moveViewTo(this._model, id, position);
  }

  viewDataUpdate<ViewData extends DataViewDataType>(
    id: string,
    updater: (data: ViewData) => Partial<ViewData>
  ): void {
    updateView(this._model, id, updater);
  }

  viewMetaGet(type: string): ViewMeta {
    const view = databaseBlockViewMap[type];
    if (!view) {
      throw new BlockSuiteError(
        ErrorCode.DatabaseBlockError,
        `Unknown view type: ${type}`
      );
    }
    return view;
  }

  viewMetaGetById(viewId: string): ViewMeta | undefined {
    const view = this.viewDataGet(viewId);
    if (!view) {
      return;
    }
    return this.viewMetaGet(view.mode);
  }
}

export const databaseViewInitTemplate = (
  datasource: DatabaseBlockDataSource,
  viewType: string,
  options?: {
    taskWorkflowDefaults?: ReturnType<typeof TaskWorkflowDefaultsSchema.parse>;
  }
) => {
  const taskWorkflowDefaults =
    options?.taskWorkflowDefaults ?? DEFAULT_TASK_WORKFLOW_DEFAULTS;
  datasource.setTaskStatusInheritance(
    taskWorkflowDefaults.database.taskStatusInheritance
  );
  if (viewType === 'kanban' || viewType === 'list') {
    const statusColumnId = datasource.propertyAdd('end', {
      type: 'select',
      name:
        taskWorkflowDefaults.list.statusMapping.statusColumnName || 'Status',
    });
    if (statusColumnId) {
      datasource.propertyDataSet(statusColumnId, {
        options: createTaskWorkflowStatusOptions(
          taskWorkflowDefaults,
          taskWorkflowDefaults.list.statusMapping.doneTagLabel
        ),
      });
    }
  }
  Array.from({ length: 3 }).forEach(() => {
    datasource.rowAdd('end');
  });
  datasource.viewManager.viewAdd(viewType);
};

const addDatabaseViewWithoutCapture = (
  datasource: DatabaseBlockDataSource,
  viewType: string
) => {
  const meta = datasource.viewMetaGet(viewType);
  const id = nanoid();
  const data = meta.model.defaultData(datasource.viewManager);
  datasource.viewDataAddWithoutCapture({
    ...data,
    id,
    name: meta.model.defaultName,
    mode: viewType,
  });
  datasource.viewManager.setCurrentView(id);
  return id;
};

export const convertToDatabase = (host: EditorHost, viewType: string) => {
  const [_, ctx] = host.std.command.exec(getSelectedModelsCommand, {
    types: ['block', 'text'],
  });
  const { selectedModels } = ctx;
  const firstModel = selectedModels?.[0];
  if (!firstModel) return;

  host.store.captureSync();

  let insertionTarget = firstModel;
  let parentModel = host.store.getParent(insertionTarget);
  while (parentModel?.flavour === 'affine:list') {
    insertionTarget = parentModel;
    parentModel = host.store.getParent(insertionTarget);
  }
  if (!parentModel) {
    return;
  }

  const id = host.store.addBlock(
    'affine:database',
    {},
    parentModel,
    parentModel.children.indexOf(insertionTarget)
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    return;
  }

  host.store.transact(() => {
    const getPathFromRoot = (model: BlockModel) => {
      const path: number[] = [];
      let current: BlockModel | null = model;
      while (current) {
        const parent = host.store.getParent(current);
        if (!parent) break;
        path.unshift(
          parent.children.findIndex(child => child.id === current?.id)
        );
        current = parent;
      }
      return path;
    };

    const comparePath = (a: number[], b: number[]) => {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        const left = a[i] ?? -1;
        const right = b[i] ?? -1;
        if (left !== right) return left - right;
      }
      return a.length - b.length;
    };

    const orderedSelectedModels = [...selectedModels].sort((a, b) =>
      comparePath(getPathFromRoot(a), getPathFromRoot(b))
    );

    const collectTodoRowsPreorder = (roots: BlockModel[]) => {
      const visited = new Set<string>();
      const result: ListBlockModel[] = [];

      const walk = (node: BlockModel) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);

        if (node.flavour === 'affine:list' && node.props.type === 'todo') {
          result.push(node as ListBlockModel);
        }

        for (const child of node.children) {
          walk(child);
        }
      };

      for (const root of roots) {
        walk(root);
      }

      return result;
    };

    const datasource = new DatabaseBlockDataSource(databaseModel);

    const taskWorkflowDefaults = TaskWorkflowDefaultsSchema.parse(
      host.std.getOptional(EditorSettingProvider)?.setting$.peek()
        .taskWorkflowDefaults
    );
    const isTodoSelection = orderedSelectedModels.every(
      model => model.flavour === 'affine:list' && model.props.type === 'todo'
    );
    if (!isTodoSelection) {
      host.store.moveBlocks(orderedSelectedModels, databaseModel);
      addDatabaseViewWithoutCapture(datasource, viewType);
      host.selection.clear();
      return;
    }

    databaseModel.props.taskStatusInheritance =
      taskWorkflowDefaults.database.taskStatusInheritance;

    const listRows = collectTodoRowsPreorder(orderedSelectedModels);
    const hierarchyLevelByRowId = new Map<string, number>();
    const parentTaskIdentityByRowId = new Map<string, string | undefined>();
    const ancestorTaskIdentitiesByRowId = new Map<string, string | undefined>();
    const getHierarchyLevel = (row: ListBlockModel) => {
      let depth = 0;
      let parent = host.store.getParent(row) as ListBlockModel | null;
      while (
        parent?.flavour === 'affine:list' &&
        parent.props.type === 'todo'
      ) {
        depth += 1;
        parent = host.store.getParent(parent) as ListBlockModel | null;
      }
      return depth;
    };
    for (const row of listRows) {
      hierarchyLevelByRowId.set(row.id, getHierarchyLevel(row));
      const ancestors: string[] = [];
      let parent = host.store.getParent(row) as ListBlockModel | null;
      while (
        parent?.flavour === 'affine:list' &&
        parent.props.type === 'todo'
      ) {
        ancestors.unshift(
          createTaskIdentity({
            docId: host.store.id,
            blockId: parent.id,
          })
        );
        parent = host.store.getParent(parent) as ListBlockModel | null;
      }
      const directParentIdentity = ancestors.at(-1);
      if (directParentIdentity) {
        parentTaskIdentityByRowId.set(row.id, directParentIdentity);
      }
      if (ancestors.length > 0) {
        ancestorTaskIdentitiesByRowId.set(
          row.id,
          encodeTaskAncestorIdentities(ancestors)
        );
      }
    }

    const getTodoFieldConfigRoot = (row: ListBlockModel) => {
      let root: ListBlockModel = row;
      let parent = host.store.getParent(root) as ListBlockModel | null;
      while (
        parent?.flavour === 'affine:list' &&
        parent.props.type === 'todo'
      ) {
        root = parent;
        parent = host.store.getParent(root) as ListBlockModel | null;
      }
      return root;
    };
    const fieldDefsByRowId = new Map<
      string,
      Array<{ key: string; label: string; type: TodoFieldType }>
    >();
    const statusMappingByRowId = new Map<
      string,
      | {
          statusColumnName: string;
          doneTagLabel: string;
          notDoneTagLabel?: string;
        }
      | undefined
    >();
    for (const row of listRows) {
      const root = getTodoFieldConfigRoot(row);
      fieldDefsByRowId.set(
        row.id,
        root.props.todoFieldDefs ?? taskWorkflowDefaults.list.fieldDefs
      );
      statusMappingByRowId.set(row.id, root.props.todoDatabaseStatusMapping);
    }

    for (const row of listRows) {
      const rowModel = host.store.getModelById(row.id);
      if (!rowModel) {
        continue;
      }
      host.store.moveBlocks([rowModel], databaseModel);
    }
    const fieldDefs = new Map<string, { label: string; type: TodoFieldType }>();
    let statusColumnName =
      taskWorkflowDefaults.list.statusMapping.statusColumnName || 'Status';
    let doneTagLabel =
      taskWorkflowDefaults.list.statusMapping.doneTagLabel || 'Done';
    let notDoneTagLabel =
      taskWorkflowDefaults.list.statusMapping.notDoneTagLabel || undefined;

    for (const row of listRows) {
      for (const def of fieldDefsByRowId.get(row.id) ?? []) {
        fieldDefs.set(def.key, { label: def.label, type: def.type });
      }
      const statusMapping = statusMappingByRowId.get(row.id);
      if (statusMapping) {
        statusColumnName = statusMapping.statusColumnName || statusColumnName;
        doneTagLabel = statusMapping.doneTagLabel || doneTagLabel;
        notDoneTagLabel = statusMapping.notDoneTagLabel || undefined;
      }
    }

    const statusOptions = createTaskWorkflowStatusOptions(
      taskWorkflowDefaults,
      doneTagLabel
    );
    if (notDoneTagLabel) {
      statusOptions.unshift({
        id: 'not_done',
        value: notDoneTagLabel,
        color: 'var(--affine-tag-yellow)',
      });
    }
    const statusColumnId = addProperty(
      databaseModel,
      'end',
      databaseBlockProperties.selectColumnConfig.create(statusColumnName, {
        options: statusOptions,
      })
    );

    if (fieldDefs.size > 0) {
      const selectOptionsByKey = new Map<
        string,
        Map<string, { id: string; value: string; color: string }>
      >();
      const getSelectOptionNames = (value: unknown, multi: boolean) =>
        String(value ?? '')
          .split(multi ? ',' : '\u0000')
          .map(v => v.trim())
          .filter(Boolean);
      for (const [key, def] of fieldDefs) {
        if (def.type !== 'select' && def.type !== 'multi_select') continue;
        const options = new Map<
          string,
          { id: string; value: string; color: string }
        >();
        for (const row of listRows) {
          for (const name of getSelectOptionNames(
            row.props.todoFieldValues?.[key],
            def.type === 'multi_select'
          )) {
            if (!options.has(name)) {
              options.set(name, {
                id: nanoid(),
                value: name,
                color: 'var(--affine-tag-blue)',
              });
            }
          }
        }
        selectOptionsByKey.set(key, options);
      }
      const columnByKey = new Map<
        string,
        { id: string; type: TodoFieldType }
      >();
      for (const [key, def] of fieldDefs) {
        const selectOptions = [
          ...(selectOptionsByKey.get(key)?.values() ?? []),
        ];
        const columnId = addProperty(
          databaseModel,
          'end',
          def.type === 'number'
            ? databaseBlockProperties.numberColumnConfig.create(def.label)
            : def.type === 'progress'
              ? databaseBlockProperties.progressColumnConfig.create(def.label)
              : def.type === 'date'
                ? databaseBlockProperties.dateColumnConfig.create(def.label)
                : def.type === 'select'
                  ? databaseBlockProperties.selectColumnConfig.create(
                      def.label,
                      {
                        options: selectOptions,
                      }
                    )
                  : def.type === 'multi_select'
                    ? databaseBlockProperties.multiSelectColumnConfig.create(
                        def.label,
                        { options: selectOptions }
                      )
                    : databaseBlockProperties.richTextColumnConfig.create(
                        def.label
                      )
        );
        columnByKey.set(key, { id: columnId, type: def.type });
      }

      for (const row of listRows) {
        for (const [key, value] of Object.entries(
          row.props.todoFieldValues ?? {}
        )) {
          const column = columnByKey.get(key);
          if (!column) continue;
          const numericValue =
            column.type === 'number' || column.type === 'progress'
              ? Number(value)
              : undefined;
          if (
            (column.type === 'number' || column.type === 'progress') &&
            !Number.isFinite(numericValue)
          ) {
            continue;
          }
          if (
            column.type === 'progress' &&
            (numericValue == null || numericValue < 0 || numericValue > 100)
          ) {
            continue;
          }
          const dateValue =
            column.type === 'date' ? parseTaskDateFieldValue(value) : undefined;
          if (column.type === 'date' && dateValue == null) continue;
          const selectOptions = selectOptionsByKey.get(key);
          const selectValue =
            column.type === 'select'
              ? selectOptions?.get(String(value).trim())?.id
              : undefined;
          const multiSelectValue =
            column.type === 'multi_select'
              ? getSelectOptionNames(value, true)
                  .map(name => selectOptions?.get(name)?.id)
                  .filter((id): id is string => Boolean(id))
              : undefined;
          updateCell(databaseModel, row.id, {
            columnId: column.id,
            value:
              column.type === 'number' || column.type === 'progress'
                ? numericValue
                : column.type === 'date'
                  ? dateValue
                  : column.type === 'select'
                    ? selectValue
                    : column.type === 'multi_select'
                      ? multiSelectValue
                      : new Text(String(value)),
          });
        }
      }
    }

    const hierarchyLevelColumnId = addProperty(
      databaseModel,
      'end',
      databaseBlockProperties.numberColumnConfig.create(
        TASK_HIERARCHY_LEVEL_COLUMN_NAME
      )
    );
    const parentTaskIdentityColumnId = addProperty(
      databaseModel,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );
    const ancestorTaskIdentitiesColumnId = addProperty(
      databaseModel,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME
      )
    );

    for (const row of listRows) {
      if (row.props.checked) {
        updateCell(databaseModel, row.id, {
          columnId: statusColumnId,
          value: 'done',
        });
        databaseModel.props.taskStatusState = {
          ...databaseModel.props.taskStatusState,
          [row.id]: {
            provenance: 'manual',
            manualLock: 'done_locked',
          },
        };
      } else if (notDoneTagLabel) {
        updateCell(databaseModel, row.id, {
          columnId: statusColumnId,
          value: 'not_done',
        });
        databaseModel.props.taskStatusState = {
          ...databaseModel.props.taskStatusState,
          [row.id]: {
            provenance: 'manual',
            manualLock: 'none',
          },
        };
      }
      updateCell(databaseModel, row.id, {
        columnId: hierarchyLevelColumnId,
        value: hierarchyLevelByRowId.get(row.id) ?? 0,
      });
      const parentIdentity = parentTaskIdentityByRowId.get(row.id);
      if (parentIdentity) {
        updateCell(databaseModel, row.id, {
          columnId: parentTaskIdentityColumnId,
          value: new Text(parentIdentity),
        });
      }
      const ancestorIdentities = ancestorTaskIdentitiesByRowId.get(row.id);
      if (ancestorIdentities) {
        updateCell(databaseModel, row.id, {
          columnId: ancestorTaskIdentitiesColumnId,
          value: new Text(ancestorIdentities),
        });
      }

      updateCell(databaseModel, row.id, {
        columnId: TASK_INTEROP_COLUMN_ID,
        value: createDatabaseRowTaskInteropLink({
          docId: host.store.id,
          blockId: row.id,
          databaseId: databaseModel.id,
          sourceFlavor: row.flavour,
        }),
      });
    }

    addDatabaseViewWithoutCapture(datasource, viewType);

    const hideColumnByDefaultInViews = (columnId: string) => {
      for (const view of databaseModel.props.views) {
        if (view.mode === 'kanban') {
          updateView(databaseModel, view.id, data => {
            const columns = (data.columns ?? []) as Array<{
              id: string;
              hide?: boolean;
            }>;
            const idx = columns.findIndex(column => column.id === columnId);
            if (idx >= 0) {
              const current = columns[idx];
              if (!current) return {};
              const next = [...columns];
              next[idx] = { ...current, hide: true };
              return { columns: next };
            }
            return { columns: [...columns, { id: columnId, hide: true }] };
          });
        }

        if (view.mode === 'table') {
          updateView(databaseModel, view.id, data => {
            const columns = (data.columns ?? []) as Array<{
              id: string;
              width: number;
              hide?: boolean;
            }>;
            const idx = columns.findIndex(column => column.id === columnId);
            if (idx >= 0) {
              const current = columns[idx];
              if (!current) return {};
              const next = [...columns];
              next[idx] = { ...current, hide: true };
              return { columns: next };
            }
            return {
              columns: [...columns, { id: columnId, width: 180, hide: true }],
            };
          });
        }
      }
    };

    hideColumnByDefaultInViews(parentTaskIdentityColumnId);
    hideColumnByDefaultInViews(ancestorTaskIdentitiesColumnId);
    hideColumnByDefaultInViews(hierarchyLevelColumnId);

    const selectionManager = host.selection;
    selectionManager.clear();
  });
};
