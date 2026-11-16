import {
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';

import type { SingleView } from '../../core/view-manager/single-view.js';
import { normalizeHierarchyLevel } from '../table/utils.js';
import { addRowAfterSameLevel } from './add-row-after.js';

/** Clipboard type carrying copied rows between tables. */
export const BLOCKSUITE_DATABASE_ROWS = 'blocksuite/database/rows';

export type ClipboardRow = {
  title: string;
  /** Indent level, relative to the shallowest copied row. */
  level: number;
  /** Task done state, or null when the table has no task status. */
  done: boolean | null;
  /** Other columns' values as text, by column name. */
  values: Record<string, string>;
};

type TaskDataSource = {
  getTaskStatusInfo?: (
    rowId: string
  ) => { columnId: string; checked: boolean } | null;
  setTaskStatusChecked?: (rowId: string, checked: boolean) => void;
  setRowHierarchyLevel?: (rowId: string, level: number) => void;
};

const HIDDEN_COLUMNS = new Set([
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
]);

const taskSource = (view: SingleView) =>
  view.manager.dataSource as unknown as TaskDataSource;

/** The rows, in the order given, as clipboard rows. */
export function rowsToClipboardRows(
  view: SingleView,
  rowIds: string[]
): ClipboardRow[] {
  const properties = view.propertiesRaw$.value;
  const title = properties.find(property => property.type$.value === 'title');
  const levelProperty = properties.find(
    property => property.name$.value === TASK_HIERARCHY_LEVEL_COLUMN_NAME
  );
  const source = taskSource(view);
  const rows = rowIds.map(rowId => {
    const status = source.getTaskStatusInfo?.(rowId) ?? null;
    const values: Record<string, string> = {};
    for (const property of properties) {
      const name = property.name$.value;
      if (
        property === title ||
        HIDDEN_COLUMNS.has(name) ||
        property.id === status?.columnId
      ) {
        continue;
      }
      values[name] = property.stringValueGet(rowId) ?? '';
    }
    return {
      title: title?.stringValueGet(rowId) ?? '',
      level: levelProperty
        ? normalizeHierarchyLevel(
            levelProperty.cellGetOrCreate(rowId).jsonValue$.value
          )
        : 0,
      done: status ? status.checked : null,
      values,
    };
  });
  const minLevel = Math.min(...rows.map(row => row.level));
  return rows.map(row => ({ ...row, level: row.level - minLevel }));
}

/** `- [ ] task` / `- [x] task`, two spaces per indent level. */
export function clipboardRowsToMarkdown(rows: ClipboardRow[]): string {
  return rows
    .map(row => {
      const box = row.done === null ? '' : row.done ? '[x] ' : '[ ] ';
      return `${'  '.repeat(row.level)}- ${box}${row.title}`;
    })
    .join('\n');
}

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A nested list with a checkbox per task. */
export function clipboardRowsToHtml(rows: ClipboardRow[]): string {
  let html = '';
  let depth = -1;
  for (const row of rows) {
    const level = Math.min(row.level, depth + 1);
    if (level > depth) {
      html += '<ul>';
    } else {
      html += '</li>';
      for (let d = depth; d > level; d--) html += '</ul></li>';
    }
    depth = level;
    const box =
      row.done === null
        ? ''
        : `<input type="checkbox" disabled${row.done ? ' checked' : ''}> `;
    html += `<li>${box}${escapeHtml(row.title)}`;
  }
  if (depth < 0) return '';
  html += '</li>';
  for (let d = depth; d > 0; d--) html += '</ul></li>';
  return html + '</ul>';
}

/** Clipboard type of AFFiNE block snapshots (what pasting into a page reads first). */
export const BLOCKSUITE_SNAPSHOT = 'BLOCKSUITE/SNAPSHOT';

type ListBlockSnapshot = {
  type: 'block';
  id: string;
  flavour: 'affine:list';
  props: Record<string, unknown>;
  children: ListBlockSnapshot[];
};

/**
 * The rows as AFFiNE to-do (or bulleted) list blocks, nested by level, in
 * the clipboard's snapshot format. Pasted into a page they become a to-do
 * list with the ticks kept; the HTML and Markdown importers drop them.
 */
export function clipboardRowsToSnapshot(
  rows: ClipboardRow[],
  ids: { workspaceId: string; pageId: string }
): string {
  const roots: ListBlockSnapshot[] = [];
  const stack: ListBlockSnapshot[] = [];
  for (const row of rows) {
    const block: ListBlockSnapshot = {
      type: 'block',
      id: crypto.randomUUID(),
      flavour: 'affine:list',
      props: {
        type: row.done === null ? 'bulleted' : 'todo',
        checked: row.done ?? false,
        collapsed: false,
        order: null,
        text: {
          '$blocksuite:internal:text$': true,
          delta: row.title ? [{ insert: row.title }] : [],
        },
      },
      children: [],
    };
    const level = Math.min(row.level, stack.length);
    stack.length = level;
    (level === 0 ? roots : stack[level - 1]!.children).push(block);
    stack.push(block);
  }
  return JSON.stringify({
    snapshot: { type: 'slice', content: roots, ...ids },
    blobs: {},
  });
}

/**
 * Adds the rows as new rows after `afterRowId` (and its sub-rows), or at the
 * end. Their levels are relative to `afterRowId`'s own level. Returns the
 * new rows' ids, in order.
 */
export function insertClipboardRows(
  view: SingleView,
  rows: ClipboardRow[],
  afterRowId?: string
): string[] {
  if (rows.length === 0) return [];
  const properties = view.propertiesRaw$.value;
  const title = properties.find(property => property.type$.value === 'title');
  const levelProperty = properties.find(
    property => property.name$.value === TASK_HIERARCHY_LEVEL_COLUMN_NAME
  );
  const baseLevel =
    afterRowId && levelProperty
      ? normalizeHierarchyLevel(
          levelProperty.cellGetOrCreate(afterRowId).jsonValue$.value
        )
      : 0;
  const source = taskSource(view);
  const ids: string[] = [];
  for (const row of rows) {
    const previous = ids.at(-1);
    const id = previous
      ? view.rowAdd({ before: false, id: previous })
      : afterRowId
        ? addRowAfterSameLevel(view, afterRowId, position =>
            view.rowAdd(position as never)
          )
        : view.rowAdd('end');
    ids.push(id);
    title?.valueSetFromString(id, row.title);
    for (const property of properties) {
      const value = row.values[property.name$.value];
      if (value !== undefined && property !== title) {
        property.valueSetFromString(id, value);
      }
    }
  }
  if (source.setRowHierarchyLevel) {
    rows.forEach((row, i) =>
      source.setRowHierarchyLevel?.(ids[i]!, baseLevel + row.level)
    );
  }
  rows.forEach((row, i) => {
    if (row.done !== null) source.setTaskStatusChecked?.(ids[i]!, row.done);
  });
  return ids;
}
