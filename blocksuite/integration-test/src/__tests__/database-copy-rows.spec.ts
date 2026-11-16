import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { TextSelection } from '@blocksuite/affine/std';
import { Text } from '@blocksuite/store';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-11 (inbox, 2026-11-14): copy several task rows and paste them as new
// rows into another table, as a to-do list into a page, or as a Markdown
// task list into a text editor.
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

async function addTaskTable(titles: string[]) {
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
  vm.setCurrentView(vm.viewAdd('table'));
  await wait(300);
  const table = dbEl.querySelector('.affine-database-table') as HTMLElement & {
    logic: TableLogic;
  };
  return { databaseId, dataSource, rowIds, table };
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
    const source = await addTaskTable(['A', 'B', 'C']);
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

  test('copying task rows writes a Markdown task list and a checkbox list', async () => {
    await copySample();
    expect(written['text/plain']).toBe('- [ ] A\n  - [ ] B\n- [x] C');
    const html = new DOMParser().parseFromString(
      written['text/html'] ?? '',
      'text/html'
    );
    const boxes = [...html.querySelectorAll('input[type="checkbox"]')].map(
      box => box.hasAttribute('checked')
    );
    expect({
      boxes,
      nested: !!html.querySelector('li ul li'),
    }).toEqual({ boxes: [false, false, true], nested: true });
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

  test('pasting the rows into a page makes a to-do list', async () => {
    await copySample();
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

    // only list blocks in the note pasted into (table rows are list blocks too)
    const inNote = (id: string): boolean => {
      const parent = doc.getParent(id);
      return !!parent && (parent.id === noteId || inNote(parent.id));
    };
    const todos = doc
      .getModelsByFlavour('affine:list')
      .filter(model => inNote(model.id))
      .map(
        model => model.props as { type: string; checked: boolean; text: Text }
      )
      .map(props => ({
        type: props.type,
        checked: props.checked,
        text: props.text.toString(),
      }));
    expect(todos).toEqual([
      { type: 'todo', checked: false, text: 'A' },
      { type: 'todo', checked: false, text: 'B' },
      { type: 'todo', checked: true, text: 'C' },
    ]);
  });
});
