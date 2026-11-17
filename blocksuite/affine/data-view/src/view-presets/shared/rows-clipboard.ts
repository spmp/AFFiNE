import {
  type InsertToPosition,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';

import type { DataViewRendererConfig } from '../../core/data-view.js';
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

/** A field's text on one line, for tab-separated output. */
const oneLine = (text: string) => text.replaceAll(/[\t\r\n]+/g, ' ').trim();

/** `fields`' values for a row, with trailing empty ones dropped. */
function rowFields(row: ClipboardRow, fields: string[]) {
  const values = fields.map(name => oneLine(row.values[name] ?? ''));
  while (values.length && !values.at(-1)) values.pop();
  return values;
}

/**
 * `- [ ] task` / `- [x] task`, two spaces per indent level. `fields` (column
 * names, e.g. the List view's shown fields) follow the title,
 * tab-separated: `- [ ] task\tnote\t2026-11-20`.
 */
export function clipboardRowsToMarkdown(
  rows: ClipboardRow[],
  fields: string[] = []
): string {
  return rows
    .map(row => {
      const box = row.done === null ? '' : row.done ? '[x] ' : '[ ] ';
      const extra = rowFields(row, fields)
        .map(value => `\t${value}`)
        .join('');
      return `${'  '.repeat(row.level)}- ${box}${row.title}${extra}`;
    })
    .join('\n');
}

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A nested list with a checkbox per task; `fields` as in the Markdown. */
export function clipboardRowsToHtml(
  rows: ClipboardRow[],
  fields: string[] = []
): string {
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
    const extra = rowFields(row, fields)
      .map(value => `\t${escapeHtml(value)}`)
      .join('');
    html += `<li>${box}${escapeHtml(row.title)}${extra}`;
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

/** The view's shown columns, without the hidden task columns. */
function shownColumns(view: SingleView) {
  return view.properties$.value.filter(
    property => !HIDDEN_COLUMNS.has(property.name$.value)
  );
}

function tableCells(view: SingleView, rowIds: string[]) {
  const columns = shownColumns(view);
  const source = taskSource(view);
  const header = columns.map(column => column.name$.value);
  const rows = rowIds.map(rowId => {
    const status = source.getTaskStatusInfo?.(rowId);
    return columns.map(column =>
      column.id === status?.columnId
        ? status.checked
          ? '[x]'
          : '[ ]'
        : (column.stringValueGet(rowId) ?? '')
    );
  });
  return { header, rows };
}

/**
 * A Markdown table of the view's shown columns (a done column as `[x]` /
 * `[ ]`). Indent levels are not shown: a table cell can't hold them.
 */
export function tableRowsToMarkdown(view: SingleView, rowIds: string[]) {
  const { header, rows } = tableCells(view, rowIds);
  const cell = (text: string) =>
    text.replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>');
  const line = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`;
  return [
    line(header),
    `|${header.map(() => ' --- ').join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

/** An HTML table of the view's shown columns, for spreadsheets and rich text. */
export function tableRowsToHtml(view: SingleView, rowIds: string[]) {
  const { header, rows } = tableCells(view, rowIds);
  const cells = (tag: string, values: string[]) =>
    values
      .map(
        value =>
          `<${tag}>${escapeHtml(value).replaceAll(/\r?\n/g, '<br>')}</${tag}>`
      )
      .join('');
  return `<table><thead><tr>${cells('th', header)}</tr></thead><tbody>${rows
    .map(row => `<tr>${cells('td', row)}</tr>`)
    .join('')}</tbody></table>`;
}

type RowsClipboardLogic = {
  view: SingleView;
  root: { config: Pick<DataViewRendererConfig, 'clipboard' | 'notification'> };
};

/**
 * Copies the rows (in the order given) and says how many were copied. Into
 * a table they always paste as new rows (`blocksuite/database/rows`). The
 * other formats depend on where they were copied from:
 *
 * - `table`: a database of just these rows (pasted into a page), a Markdown
 *   table and an HTML table of the shown columns;
 * - `list` (List view, Journal Todo): a to-do list (pasted into a page), a
 *   Markdown task list and a checkbox list, with the List view's shown
 *   fields after the title, tab-separated.
 */
export function copyRowsToClipboard(
  logic: RowsClipboardLogic,
  rowIds: string[],
  kind: 'table' | 'list' = 'list'
) {
  const view = logic.view;
  const rows = rowsToClipboardRows(view, rowIds);
  const doc = (
    logic.view.manager.dataSource as {
      doc?: { id: string; workspace?: { id: string } };
    }
  ).doc;
  const ids = { workspaceId: doc?.workspace?.id ?? '', pageId: doc?.id ?? '' };
  const { clipboard, notification } = logic.root.config;
  let text: string;
  let html: string;
  let snapshot: string;
  if (kind === 'table') {
    text = tableRowsToMarkdown(view, rowIds);
    html = tableRowsToHtml(view, rowIds);
    const database = (
      view.manager.dataSource as {
        rowsSnapshot?: (rowIds: string[], viewId?: string) => unknown;
      }
    ).rowsSnapshot?.(rowIds, view.id);
    snapshot = database
      ? JSON.stringify({
          snapshot: { type: 'slice', content: [database], ...ids },
          blobs: {},
        })
      : clipboardRowsToSnapshot(rows, ids);
  } else {
    const statusColumn = rowIds
      .map(id => taskSource(view).getTaskStatusInfo?.(id)?.columnId)
      .find(Boolean);
    const fields = view.detailProperties$.value
      .filter(
        property =>
          property.id !== statusColumn &&
          !HIDDEN_COLUMNS.has(property.name$.value) &&
          property.type$.value !== 'title'
      )
      .map(property => property.name$.value);
    text = clipboardRowsToMarkdown(rows, fields);
    html = clipboardRowsToHtml(rows, fields);
    snapshot = clipboardRowsToSnapshot(rows, ids);
  }
  clipboard
    .writeToClipboard(items => ({
      ...items,
      'text/plain': text,
      'text/html': html,
      [BLOCKSUITE_DATABASE_ROWS]: JSON.stringify(rows),
      [BLOCKSUITE_SNAPSHOT]: snapshot,
    }))
    .then(() => {
      notification.toast(
        `${rows.length} row${rows.length > 1 ? 's' : ''} copied to clipboard`
      );
    })
    .catch(console.error);
}

/** The rows on the clipboard, if it holds rows copied from a database. */
export function readClipboardRows(
  logic: RowsClipboardLogic,
  data: DataTransfer | null
): ClipboardRow[] | undefined {
  if (!data) return;
  try {
    const json = logic.root.config.clipboard.readFromClipboard(data);
    const rowsString = json[BLOCKSUITE_DATABASE_ROWS];
    const rows = rowsString
      ? (JSON.parse(rowsString) as ClipboardRow[])
      : undefined;
    return rows?.length ? rows : undefined;
  } catch {
    return;
  }
}

/**
 * Adds the rows as new rows after `afterRowId` (and its sub-rows), or at the
 * end. Their levels are relative to `afterRowId`'s own level. `addRow`
 * makes a row (the List view makes to-do rows). Returns the new rows' ids,
 * in order.
 */
export function insertClipboardRows(
  view: SingleView,
  rows: ClipboardRow[],
  afterRowId?: string,
  addRow: (position: InsertToPosition | number) => string = position =>
    view.rowAdd(position as InsertToPosition)
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
      ? addRow({ before: false, id: previous })
      : afterRowId
        ? addRowAfterSameLevel(view, afterRowId, addRow)
        : addRow('end');
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
