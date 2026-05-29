import type {
  ColumnDataType,
  ColumnUpdater,
  DatabaseBlockModel,
  ListBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/affine-model';
import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { FeatureFlagService } from '@blocksuite/affine-shared/services';
import {
  createDatabaseRowTaskInteropLink,
  createTaskIdentity,
  encodeTaskAncestorIdentities,
  insertPositionToIndex,
  type InsertToPosition,
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
import { type BlockModel, Text } from '@blocksuite/store';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';

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

const TASK_INTEROP_COLUMN_ID = '__affine_task_interop_link';
const READONLY_SYSTEM_COLUMN_NAMES = new Set([
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
]);

export type TaskIdentityRowLookup =
  | { status: 'unique'; rowId: string }
  | { status: 'missing' }
  | { status: 'duplicate'; rowIds: [string, string] };
import {
  databaseBlockViewConverts,
  databaseBlockViewMap,
  databaseBlockViews,
} from './views/index.js';

type SpacialProperty = {
  valueSet: (rowId: string, propertyId: string, value: unknown) => void;
  valueGet: (rowId: string, propertyId: string) => unknown;
};

export class DatabaseBlockDataSource extends DataSourceBase {
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
      const index = insertPositionToIndex(position, this._model.children);
      const target = this._model.children[index];
      if (target?.id === rowId) {
        return;
      }
      this.doc.moveBlocks([model], this._model, target);
    }
  }

  viewDataAdd(viewData: DataViewDataType): string {
    this._model.store.captureSync();
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
  viewType: string
) => {
  Array.from({ length: 3 }).forEach(() => {
    datasource.rowAdd('end');
  });
  datasource.viewManager.viewAdd(viewType);
};
export const convertToDatabase = (host: EditorHost, viewType: string) => {
  const [_, ctx] = host.std.command.exec(getSelectedModelsCommand, {
    types: ['block', 'text'],
  });
  const { selectedModels } = ctx;
  const firstModel = selectedModels?.[0];
  if (!firstModel) return;

  host.store.captureSync();

  const parentModel = host.store.getParent(firstModel);
  if (!parentModel) {
    return;
  }

  const id = host.store.addBlock(
    'affine:database',
    {},
    parentModel,
    parentModel.children.indexOf(firstModel)
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    return;
  }
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
  datasource.viewManager.viewAdd(viewType);

  const listRows = collectTodoRowsPreorder(orderedSelectedModels);
  const hierarchyLevelByRowId = new Map<string, number>();
  const parentTaskIdentityByRowId = new Map<string, string | undefined>();
  const ancestorTaskIdentitiesByRowId = new Map<string, string | undefined>();
  const getHierarchyLevel = (row: ListBlockModel) => {
    let depth = 0;
    let parent = host.store.getParent(row) as ListBlockModel | null;
    while (parent?.flavour === 'affine:list' && parent.props.type === 'todo') {
      depth += 1;
      parent = host.store.getParent(parent) as ListBlockModel | null;
    }
    return depth;
  };
  for (const row of listRows) {
    hierarchyLevelByRowId.set(row.id, getHierarchyLevel(row));
    const ancestors: string[] = [];
    let parent = host.store.getParent(row) as ListBlockModel | null;
    while (parent?.flavour === 'affine:list' && parent.props.type === 'todo') {
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

  host.store.moveBlocks(orderedSelectedModels, databaseModel);

  const desiredRowOrder = listRows.map(row => row.id);
  for (let i = 0; i < desiredRowOrder.length; i++) {
    const rowId = desiredRowOrder[i];
    if (!rowId) continue;
    const currentIndex = databaseModel.children.findIndex(c => c.id === rowId);
    if (currentIndex < 0 || currentIndex === i) {
      continue;
    }

    const rowModel = host.store.getModelById(rowId);
    const targetModel = databaseModel.children[i];
    if (!rowModel) {
      continue;
    }
    host.store.moveBlocks([rowModel], databaseModel, targetModel);
  }

  const fieldDefs = new Map<
    string,
    { label: string; type: 'text' | 'number' }
  >();

  for (const row of listRows) {
    let root: ListBlockModel = row;
    let parent = host.store.getParent(root) as ListBlockModel | null;
    while (parent?.flavour === 'affine:list' && parent.props.type === 'todo') {
      root = parent;
      parent = host.store.getParent(root) as ListBlockModel | null;
    }
    for (const def of root.props.todoFieldDefs ?? []) {
      fieldDefs.set(def.key, { label: def.label, type: def.type });
    }
  }

  if (fieldDefs.size > 0) {
    const columnByKey = new Map<
      string,
      { id: string; type: 'text' | 'number' }
    >();
    for (const [key, def] of fieldDefs) {
      const columnId = addProperty(
        databaseModel,
        'end',
        def.type === 'number'
          ? databaseBlockProperties.numberColumnConfig.create(def.label)
          : databaseBlockProperties.richTextColumnConfig.create(def.label)
      );
      columnByKey.set(key, { id: columnId, type: def.type });
    }

    for (const row of listRows) {
      for (const [key, value] of Object.entries(
        row.props.todoFieldValues ?? {}
      )) {
        const column = columnByKey.get(key);
        if (!column) continue;
        updateCell(databaseModel, row.id, {
          columnId: column.id,
          value: column.type === 'number' ? value : new Text(String(value)),
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

    datasource.setTaskInteropLink(
      row.id,
      createDatabaseRowTaskInteropLink({
        docId: host.store.id,
        blockId: row.id,
        databaseId: databaseModel.id,
        sourceFlavor: row.flavour,
      })
    );
  }

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

  const selectionManager = host.selection;
  selectionManager.clear();
};
