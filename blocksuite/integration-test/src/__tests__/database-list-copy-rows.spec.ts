import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { insertDatabaseRefBlockCommand } from '@blocksuite/affine/blocks/database-ref';
import { BlockSelection } from '@blocksuite/affine/std';
import { Text } from '@blocksuite/store';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-11 (inbox, 2026-11-14), List view (the Journal Todo's view): select
// rows from the keyboard or the drag handle, copy them, and paste them as
// new rows, after the selected rows or after the row being typed in.
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

async function addTaskList(titles: string[]) {
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
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd('list'));
  await wait(300);
  const row = (id: string) =>
    dbEl.querySelector(
      `.affine-data-view-list-row[data-row-id="${id}"]`
    ) as HTMLElement;
  const title = (id: string) =>
    row(id).querySelector('data-view-header-area-text') as HTMLElement;
  const selectedRows = () =>
    Array.from(
      dbEl.querySelectorAll('.affine-data-view-list-row[data-selected="true"]')
    ).map(el => (el as HTMLElement).dataset.rowId);
  const rowsInOrder = () =>
    doc.getModelById(databaseId)!.children.map(child => child.id);
  const describeRow = (id: string) => ({
    title: (doc.getModelById(id)!.props as { text: Text }).text.toString(),
    level: dataSource.getRowHierarchyLevel(id),
    done: dataSource.getTaskStatusInfo(id)?.checked ?? false,
  });
  return {
    databaseId,
    dataSource,
    rowIds,
    row,
    title,
    selectedRows,
    rowsInOrder,
    describeRow,
  };
}

type TaskList = Awaited<ReturnType<typeof addTaskList>>;

async function editTitle(list: TaskList, rowId: string) {
  await userEvent.click(list.title(rowId));
  await wait(150);
}

function pasteEvent() {
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

function copy() {
  document.dispatchEvent(
    new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    })
  );
}

describe('database list view: select and copy rows (F-11)', () => {
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

  test('Escape in a row selects it; Shift+Down extends; copy writes the task list', async () => {
    const list = await addTaskList(['A', 'B', 'C']);
    const [a, b, c] = list.rowIds as [string, string, string];
    list.dataSource.setTaskStatusChecked(b, true);
    await wait(100);
    await editTitle(list, a);
    await userEvent.keyboard('{Escape}');
    await wait(500);
    // the row keeps focus and stays selected (nothing re-focuses the title)
    expect({
      selected: list.selectedRows(),
      focused: document.activeElement === list.row(a),
    }).toEqual({ selected: [a], focused: true });
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await wait(100);
    expect(list.selectedRows()).toEqual([a, b]);
    copy();
    await wait(300);
    expect(written['text/plain']).toBe('- [ ] A\n- [x] B');
    // the title wasn't edited, and C isn't selected
    expect(list.describeRow(c).title).toBe('C');
  });

  test('clicking the drag handle selects a row; Shift+click selects a range', async () => {
    const list = await addTaskList(['A', 'B', 'C']);
    const [a, , c] = list.rowIds as [string, string, string];
    const handle = (id: string) =>
      list.row(id).querySelector('[data-testid="drag-handle"]') as HTMLElement;
    handle(a).dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true })
    );
    await wait(100);
    expect(list.selectedRows()).toEqual([a]);
    handle(c).dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        composed: true,
        shiftKey: true,
      })
    );
    await wait(100);
    expect(list.selectedRows()).toEqual(list.rowIds);
  });

  test('pasting rows with a row selected adds them after it as new rows', async () => {
    const source = await addTaskList(['A', 'B', 'C']);
    const [a, b, c] = source.rowIds as [string, string, string];
    source.dataSource.setPendingHierarchyLevel(b, 1);
    source.dataSource.applyPendingHierarchyLevel(b);
    source.dataSource.setTaskStatusChecked(c, true);
    await wait(100);
    await editTitle(source, a);
    await userEvent.keyboard('{Escape}{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    await wait(100);
    copy();
    await wait(300);

    const target = await addTaskList(['X', 'Y']);
    const [x, y] = target.rowIds as [string, string];
    await editTitle(target, x);
    await userEvent.keyboard('{Escape}');
    await wait(100);
    document.dispatchEvent(pasteEvent());
    await wait(300);
    const order = target.rowsInOrder();
    expect(order.map(target.describeRow)).toEqual([
      { title: 'X', level: 0, done: false },
      { title: 'A', level: 0, done: false },
      { title: 'B', level: 1, done: false },
      { title: 'C', level: 0, done: true },
      { title: 'Y', level: 0, done: false },
    ]);
    expect([order[0], order[4]]).toEqual([x, y]);
    // the pasted rows are selected
    expect(target.selectedRows()).toEqual(order.slice(1, 4));
  });

  test('pasting rows while typing in a row adds them after that row, not into its text', async () => {
    const source = await addTaskList(['A', 'B']);
    await editTitle(source, source.rowIds[0]!);
    await userEvent.keyboard('{Escape}{Shift>}{ArrowDown}{/Shift}');
    await wait(100);
    expect(source.selectedRows()).toEqual(source.rowIds);
    copy();
    await wait(300);

    expect(written['text/plain']).toBe('- [ ] A\n- [ ] B');

    const target = await addTaskList(['X']);
    const [x] = target.rowIds as [string];
    await editTitle(target, x);
    target.title(x).dispatchEvent(pasteEvent());
    await wait(300);
    expect(target.rowsInOrder().map(target.describeRow)).toEqual([
      { title: 'X', level: 0, done: false },
      { title: 'A', level: 0, done: false },
      { title: 'B', level: 0, done: false },
    ]);
  });

  test('Escape with rows selected selects the whole database block', async () => {
    const list = await addTaskList(['A', 'B']);
    await editTitle(list, list.rowIds[0]!);
    await userEvent.keyboard('{Escape}');
    await wait(100);
    await userEvent.keyboard('{Escape}');
    await wait(100);
    const selected = editor.std.selection.filter(BlockSelection);
    expect(selected.map(s => s.blockId)).toEqual([list.databaseId]);
    expect(list.selectedRows()).toEqual([]);
  });

  test('Enter on a selected row edits its title again', async () => {
    const list = await addTaskList(['A', 'B']);
    const [a] = list.rowIds as [string];
    await editTitle(list, a);
    await userEvent.keyboard('{Escape}');
    await wait(100);
    await userEvent.keyboard('{Enter}');
    await wait(150);
    await userEvent.keyboard('x');
    await wait(100);
    expect({
      selected: list.selectedRows(),
      rows: list.rowsInOrder().length,
      title: list.describeRow(a).title,
    }).toEqual({ selected: [], rows: 2, title: 'Ax' });
  });

  test('works in a list shown through a reference (the Journal Todo)', async () => {
    const list = await addTaskList(['A', 'B']);
    const secondNoteId = addNote(doc);
    const anchor = doc.getBlock(secondNoteId)!.model.children[0]!;
    editor.std.command.exec(insertDatabaseRefBlockCommand, {
      refBlockId: list.databaseId,
      place: 'after',
      selectedModels: [anchor],
    });
    await wait(500);
    const ref = document.querySelector('affine-database-ref') as HTMLElement;
    const refRow = (id: string) =>
      ref.querySelector(
        `.affine-data-view-list-row[data-row-id="${id}"]`
      ) as HTMLElement;
    expect(refRow(list.rowIds[0]!)).toBeTruthy();
    await userEvent.click(
      refRow(list.rowIds[0]!).querySelector('data-view-header-area-text')!
    );
    await wait(150);
    await userEvent.keyboard('{Escape}');
    await wait(100);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await wait(100);
    const selectedInRef = Array.from(
      ref.querySelectorAll('.affine-data-view-list-row[data-selected="true"]')
    ).map(el => (el as HTMLElement).dataset.rowId);
    expect(selectedInRef).toEqual(list.rowIds);
    copy();
    await wait(300);
    expect(written['text/plain']).toBe('- [ ] A\n- [ ] B');
  });
});
