import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { TextSelection } from '@blocksuite/affine/std';
import { Text } from '@blocksuite/store';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-11 (inbox, 2026-11-14; formats revised 2026-11-17): copy table rows and
// paste them as new rows into another table, as a database of just those
// rows into a page, or as a Markdown table into a text editor. One column
// of cells copies as a plain list.
type TableLogic = {
  selectionController: { selection: unknown };
  clipboardController: {
    copy: () => void;
    _onPaste: (ctx: {
      get: (key: string) => { raw: ClipboardEvent };
    }) => Promise<unknown>;
  };
};
type DbElement = HTMLElement & {
  dataSource: {
    value: {
      viewManager: {
        viewAdd: (t: string) => string;
        setCurrentView: (id: string) => void;
      };
    };
  };
};

let written: Record<string, string> = {};
const originalWrite = navigator.clipboard.write.bind(navigator.clipboard);

async function addTaskTable(titles: string[], notes: string[] = []) {
  const noteId = addNote(doc);
  const databaseId = doc.addBlock(
    'affine:database',
    { title: new Text() },
    noteId
  );
  await wait();
  const dataSource = new DatabaseBlockDataSource(
    doc.getModelById(databaseId)! as never
  );
  const rowIds = titles.map(title => {
    const id = dataSource.rowAddAsTodoList('end');
    doc.updateBlock(doc.getModelById(id)!, { text: new Text(title) });
    return id;
  });
  const notesId = dataSource.propertyAdd('end', {
    type: 'rich-text',
    name: 'Notes',
  })!;
  notes.forEach((note, i) => {
    if (note) dataSource.cellValueChange(rowIds[i]!, notesId, new Text(note));
  });
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd('table'));
  await wait(300);
  const table = dbEl.querySelector('.affine-database-table') as HTMLElement & {
    logic: TableLogic;
  };
  return { databaseId, dataSource, rowIds, notesId, table, dbEl };
}

function selectRows(table: { logic: TableLogic }, rowIds: string[]) {
  table.logic.selectionController.selection = {
    selectionType: 'row',
    rows: rowIds.map(id => ({ id })),
  };
}

function clipboardEvent() {
  const data = new DataTransfer();
  for (const [type, value] of Object.entries(written)) {
    data.setData(type, value);
  }
  return new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
}

describe('database table: copy rows (F-11)', () => {
  beforeEach(async () => {
    written = {};
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      for (const item of items) {
        for (const type of item.types) {
          written[type] = await (await item.getType(type)).text();
        }
      }
    };
    const cleanup = await setupEditor('page');
    return cleanup;
  });
  afterEach(() => {
    navigator.clipboard.write = originalWrite;
  });

  async function copySample() {
    const source = await addTaskTable(
      ['A', 'B', 'C'],
      ['note a', '', 'note c']
    );
    const [a, b, c] = source.rowIds as [string, string, string];
    source.dataSource.setPendingHierarchyLevel(b, 1);
    source.dataSource.applyPendingHierarchyLevel(b);
    source.dataSource.setTaskStatusChecked(c, true);
    await wait(100);
    selectRows(source.table, [a, b, c]);
    await wait(50);
    source.table.logic.clipboardController.copy();
    await wait(300);
    return source;
  }

  test('copying rows writes a Markdown table and an HTML table of the shown columns', async () => {
    await copySample();
    const lines = (written['text/plain'] ?? '').split('\n');
    const cells = (line: string) =>
      line
        .slice(1, -1)
        .split('|')
        .map(cell => cell.trim());
    const header = cells(lines[0]!);
    const notes = header.indexOf('Notes');
    const status = header.findIndex(name => /status|done/i.test(name));
    const rows = lines.slice(2).map(cells);
    expect({
      separator: /^\|( *-+ *\|)+$/.test(lines[1]!),
      notesShown: notes > 0,
      titles: rows.map(row => row[0]),
      notes: rows.map(row => row[notes]),
      done: rows.map(row => row[status]),
    }).toEqual({
      separator: true,
      notesShown: true,
      titles: ['A', 'B', 'C'],
      notes: ['note a', '', 'note c'],
      done: ['[ ]', '[ ]', '[x]'],
    });
    const html = new DOMParser().parseFromString(
      written['text/html'] ?? '',
      'text/html'
    );
    expect({
      headers: html.querySelectorAll('table th').length,
      rows: html.querySelectorAll('table tbody tr').length,
      noteA: html.querySelector(
        'table tbody tr td:nth-child(' + (notes + 1) + ')'
      )?.textContent,
    }).toEqual({ headers: header.length, rows: 3, noteA: 'note a' });
  });

  test('pasting the rows into another table adds them as new rows', async () => {
    const source = await copySample();
    const target = await addTaskTable(['Z']);
    selectRows(target.table, [target.rowIds[0]!]);
    await wait(50);
    await target.table.logic.clipboardController._onPaste({
      get: () => ({ raw: clipboardEvent() }),
    });
    await wait(300);

    const rows = doc
      .getModelById(target.databaseId)!
      .children.map(row => row.id)
      .filter(id => id !== target.rowIds[0]);
    const describeRow = (id: string) => ({
      title: (doc.getModelById(id)!.props as { text: Text }).text.toString(),
      level: target.dataSource.getRowHierarchyLevel(id),
      done: target.dataSource.getTaskStatusInfo(id)?.checked ?? false,
      isNew: !source.rowIds.includes(id),
    });
    expect(rows.map(describeRow)).toEqual([
      { title: 'A', level: 0, done: false, isNew: true },
      { title: 'B', level: 1, done: false, isNew: true },
      { title: 'C', level: 0, done: true, isNew: true },
    ]);
  });

  test('pasting the rows into a page makes a database of just those rows', async () => {
    const source = await copySample();
    const noteId = addNote(doc);
    const paragraphId = doc.getModelById(noteId)!.children[0]!.id;
    await wait(200);
    const paragraphEl = document.querySelector(
      `affine-paragraph[data-block-id="${paragraphId}"]`
    ) as HTMLElement;
    paragraphEl.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true })
    );
    editor.std.selection.setGroup('note', [
      editor.std.selection.create(TextSelection, {
        from: { blockId: paragraphId, index: 0, length: 0 },
        to: null,
      }),
    ]);
    await wait();
    paragraphEl.dispatchEvent(clipboardEvent());
    await wait(500);

    const pasted = doc
      .getModelById(noteId)!
      .children.filter(child => child.flavour === 'affine:database');
    expect(pasted.length).toBe(1);
    const db = pasted[0]!;
    const pastedSource = new DatabaseBlockDataSource(db as never);
    const props = db.props as {
      columns: { id: string; name: string }[];
    };
    const notesColumn = props.columns.find(c => c.name === 'Notes')!;
    expect({
      isNew: db.id !== source.databaseId,
      rows: db.children.map(row => ({
        title: (row.props as { text: Text }).text.toString(),
        notes:
          (
            pastedSource.cellValueGet(row.id, notesColumn.id) as
              | Text
              | undefined
          )?.toString() ?? '',
        done: pastedSource.getTaskStatusInfo(row.id)?.checked ?? false,
        level: pastedSource.getRowHierarchyLevel(row.id),
        isNew: !source.rowIds.includes(row.id),
      })),
    }).toEqual({
      isNew: true,
      rows: [
        { title: 'A', notes: 'note a', done: false, level: 0, isNew: true },
        { title: 'B', notes: '', done: false, level: 1, isNew: true },
        { title: 'C', notes: 'note c', done: true, level: 0, isNew: true },
      ],
    });
  });

  test('pasting rows while editing a cell adds them after that row, not into the cell', async () => {
    await copySample();
    const target = await addTaskTable(['X', 'Y']);
    const [x] = target.rowIds as [string, string];
    const cell = target.dbEl.querySelector(
      `data-view-table-row[data-row-id="${x}"] dv-table-view-cell-container[data-column-id="${target.notesId}"]`
    ) as HTMLElement;
    await userEvent.click(cell);
    await wait(100);
    await userEvent.click(cell);
    await wait(150);
    const editable = cell.querySelector('[data-v-root]') as HTMLElement;
    editable.dispatchEvent(clipboardEvent());
    await wait(300);
    const rows = doc.getModelById(target.databaseId)!.children;
    expect({
      titles: rows.map(row => (row.props as { text: Text }).text.toString()),
      xNotes:
        (
          target.dataSource.cellValueGet(x, target.notesId) as Text | undefined
        )?.toString() ?? '',
    }).toEqual({ titles: ['X', 'A', 'B', 'C', 'Y'], xNotes: '' });
  });

  test('copying one column of cells gives a plain list', async () => {
    const source = await addTaskTable(
      ['A', 'B', 'C'],
      ['note a', 'note b', '']
    );
    const columns = source.table.querySelectorAll(
      'data-view-table-row:first-of-type dv-table-view-cell-container'
    );
    const notesIndex = Array.from(columns).findIndex(
      el => (el as HTMLElement).dataset.columnId === source.notesId
    );
    source.table.logic.selectionController.selection = {
      selectionType: 'area',
      groupKey: undefined,
      focus: { rowIndex: 0, columnIndex: notesIndex },
      rowsSelection: { start: 0, end: 2 },
      columnsSelection: { start: notesIndex, end: notesIndex },
      isEditing: false,
    };
    await wait(50);
    source.table.logic.clipboardController.copy();
    await wait(300);
    expect(written['text/plain']).toBe('- note a\n- note b');
  });
});
