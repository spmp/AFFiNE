import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { IS_MAC } from '@blocksuite/global/env';
import { Text } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-05 (inbox, 2026-11-13): indent / outdent keys don't work in a database
// Table view.
describe('database Table view: indent and outdent keys (F-05)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page');
    return cleanup;
  });

  async function setup() {
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
    const rowIds = [
      dataSource.rowAddAsTodoList('end'),
      dataSource.rowAddAsTodoList('end'),
    ];
    rowIds.forEach((id, i) =>
      doc.updateBlock(doc.getModelById(id)!, { text: new Text(`Row ${i}`) })
    );
    const dbEl = document.querySelector(
      `affine-database[data-block-id="${databaseId}"]`
    ) as HTMLElement & {
      dataSource: {
        value: {
          viewManager: {
            viewAdd: (t: string) => string;
            setCurrentView: (id: string) => void;
          };
        };
      };
    };
    const vm = dbEl.dataSource.value.viewManager;
    vm.setCurrentView(vm.viewAdd('table'));
    await wait(300);
    const table = dbEl.querySelector(
      '.affine-database-table'
    ) as HTMLElement & {
      logic: { selectionController: { selection: unknown } };
    };
    const editSecondRowTitle = async () => {
      table.logic.selectionController.selection = {
        selectionType: 'area',
        groupKey: undefined,
        focus: { rowIndex: 1, columnIndex: 0 },
        rowsSelection: { start: 1, end: 1 },
        columnsSelection: { start: 0, end: 0 },
        isEditing: true,
      };
      await wait(150);
      const richText = dbEl.querySelector(
        `data-view-table-row[data-row-id="${rowIds[1]}"] data-view-header-area-text rich-text`
      ) as HTMLElement;
      await userEvent.click(richText);
      await wait(100);
    };
    const level = () => dataSource.getRowHierarchyLevel(rowIds[1]!);
    const selectSecondRowTitle = async () => {
      table.logic.selectionController.selection = {
        selectionType: 'area',
        groupKey: undefined,
        focus: { rowIndex: 1, columnIndex: 0 },
        rowsSelection: { start: 1, end: 1 },
        columnsSelection: { start: 0, end: 0 },
        isEditing: false,
      };
      await wait(150);
    };
    return { editSecondRowTitle, selectSecondRowTitle, level, table };
  }

  const mod = IS_MAC ? 'Meta' : 'Control';

  test('Mod-Shift-. indents and Mod-Shift-, outdents the row being edited', async () => {
    const { editSecondRowTitle, level } = await setup();
    await editSecondRowTitle();
    const before = level();
    await userEvent.keyboard(`{${mod}>}{Shift>}.{/Shift}{/${mod}}`);
    await wait(150);
    const indented = level();
    await userEvent.keyboard(`{${mod}>}{Shift>},{/Shift}{/${mod}}`);
    await wait(150);
    expect({ before, indented, outdented: level() }).toEqual({
      before: 0,
      indented: 1,
      outdented: 0,
    });
  });

  test('Mod-Shift-. indents and Mod-Shift-, outdents a selected row', async () => {
    const { editSecondRowTitle, level } = await setup();
    await editSecondRowTitle();
    await userEvent.keyboard('{Escape}');
    await wait(150);
    const before = level();
    await userEvent.keyboard(`{${mod}>}{Shift>}.{/Shift}{/${mod}}`);
    await wait(150);
    const indented = level();
    await userEvent.keyboard(`{${mod}>}{Shift>},{/Shift}{/${mod}}`);
    await wait(150);
    expect({ before, indented, outdented: level() }).toEqual({
      before: 0,
      indented: 1,
      outdented: 0,
    });
  });
});
