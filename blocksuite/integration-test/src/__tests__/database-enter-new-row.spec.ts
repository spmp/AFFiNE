import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { insertDatabaseRefBlockCommand } from '@blocksuite/affine/blocks/database-ref';
import { EditorSettingExtension } from '@blocksuite/affine/shared/services';
import { Text } from '@blocksuite/store';
import { signal } from '@preact/signals-core';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-04 (inbox, 2026-11-14): the "Enter adds a new row in database tables"
// editor setting. Off (the default): Enter finishes editing a cell, as
// before. On: Enter in a text or number cell adds a row straight below,
// at the same indent level, and starts editing the same column there;
// Shift+Enter is still a newline in a text cell.
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

async function setup(enterAddsRow: boolean) {
  await setupEditor('page', [
    EditorSettingExtension({
      setting$: signal({ databaseEnterAddsRow: enterAddsRow }),
    }),
  ]);
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
    dataSource.rowAddAsTodoList('end'),
  ];
  rowIds.forEach((id, i) =>
    doc.updateBlock(doc.getModelById(id)!, { text: new Text(`Row ${i}`) })
  );
  const notesId = dataSource.propertyAdd('end', {
    type: 'rich-text',
    name: 'Notes',
  })!;
  const numberId = dataSource.propertyAdd('end', {
    type: 'number',
    name: 'Cost',
  })!;
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd('table'));
  await wait(300);

  const cell = (rowId: string, columnId: string) =>
    dbEl.querySelector(
      `data-view-table-row[data-row-id="${rowId}"] dv-table-view-cell-container[data-column-id="${columnId}"]`
    ) as HTMLElement;
  const edit = async (rowId: string, columnId: string) => {
    const target = cell(rowId, columnId);
    await userEvent.click(target);
    await wait(100);
    await userEvent.click(target);
    await wait(150);
  };
  const rows = () =>
    Array.from(dbEl.querySelectorAll('data-view-table-row')).map(
      row => (row as HTMLElement).dataset.rowId!
    );
  const editingCell = () => {
    const el = dbEl.querySelector(
      'dv-table-view-cell-container[data-editing="true"]'
    ) as HTMLElement | null;
    return el ? { row: el.dataset.rowId, column: el.dataset.columnId } : null;
  };
  return {
    dataSource,
    rowIds,
    notesId,
    numberId,
    edit,
    rows,
    editingCell,
  };
}

describe('database table: Enter adds a new row (setting)', () => {
  test('off (default): Enter in a cell finishes editing and adds no row', async () => {
    const { rowIds, notesId, edit, rows, editingCell } = await setup(false);
    await edit(rowIds[0]!, notesId);
    await userEvent.keyboard('{Enter}');
    await wait(200);
    expect({ rows: rows().length, editing: editingCell() }).toEqual({
      rows: 3,
      editing: null,
    });
  });

  for (const column of ['title', 'notes', 'number'] as const) {
    test(`on: Enter in the ${column} cell adds a row below and edits the same column`, async () => {
      const ctx = await setup(true);
      const columnId =
        column === 'title'
          ? 'title'
          : column === 'notes'
            ? ctx.notesId
            : ctx.numberId;
      await ctx.edit(ctx.rowIds[0]!, columnId);
      await userEvent.keyboard('{Enter}');
      await wait(300);
      const rows = ctx.rows();
      const newRow = rows[1]!;
      expect({
        rows: rows.length,
        newRowIsNew: !ctx.rowIds.includes(newRow),
        editing: ctx.editingCell(),
      }).toEqual({
        rows: 4,
        newRowIsNew: true,
        editing: { row: newRow, column: columnId },
      });
    });
  }

  test('on: Shift+Enter in a text cell is a newline, not a new row', async () => {
    const { dataSource, rowIds, notesId, edit, rows, editingCell } =
      await setup(true);
    await edit(rowIds[0]!, notesId);
    await userEvent.keyboard('a{Shift>}{Enter}{/Shift}b');
    await wait(200);
    const value = dataSource.cellValueGet(rowIds[0]!, notesId) as
      | { toString(): string }
      | undefined;
    expect({
      rows: rows().length,
      editing: editingCell(),
      text: value?.toString(),
    }).toEqual({
      rows: 3,
      editing: { row: rowIds[0], column: notesId },
      text: 'a\nb',
    });
  });

  test('on: the new row gets the indent level of the row Enter was pressed in', async () => {
    const { dataSource, rowIds, edit, rows } = await setup(true);
    // indent row 1 under row 0
    dataSource.setPendingHierarchyLevel(rowIds[1]!, 1);
    dataSource.applyPendingHierarchyLevel(rowIds[1]!);
    await wait(200);
    expect(dataSource.getRowHierarchyLevel(rowIds[1]!)).toBe(1);
    await edit(rowIds[1]!, 'title');
    await userEvent.keyboard('{Enter}');
    await wait(300);
    const order = rows();
    const newRow = order[2]!;
    expect({
      newRowIsNew: !rowIds.includes(newRow),
      level: dataSource.getRowHierarchyLevel(newRow),
    }).toEqual({ newRowIsNew: true, level: 1 });
  });

  test('on: also works in a table shown through a reference', async () => {
    const ctx = await setup(true);
    // a second reference turns both places into references to the table
    const secondNoteId = addNote(doc);
    const anchor = doc.getBlock(secondNoteId)!.model.children[0]!;
    editor.std.command.exec(insertDatabaseRefBlockCommand, {
      refBlockId: doc.getParent(ctx.rowIds[0]!)!.id,
      place: 'after',
      selectedModels: [anchor],
    });
    await wait(500);
    const ref = document.querySelector('affine-database-ref') as HTMLElement;
    expect(ref).toBeTruthy();
    const cellIn = (rowId: string) =>
      ref.querySelector(
        `data-view-table-row[data-row-id="${rowId}"] dv-table-view-cell-container[data-column-id="title"]`
      ) as HTMLElement | null;
    const target =
      cellIn(ctx.rowIds[0]!) ??
      (ref.querySelector(
        'data-view-table-row dv-table-view-cell-container[data-column-index="0"]'
      ) as HTMLElement | null);
    expect(target).toBeTruthy();
    await userEvent.click(target!);
    await wait(100);
    await userEvent.click(target!);
    await wait(150);
    await userEvent.keyboard('{Enter}');
    await wait(400);
    const databaseId = doc.getParent(ctx.rowIds[0]!)!.id;
    expect(doc.getModelById(databaseId)!.children.length).toBe(4);
  });
});
