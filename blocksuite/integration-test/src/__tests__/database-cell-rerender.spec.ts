import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { Text } from '@blocksuite/store';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-08 (live, 2026-11-17): typing in one cell re-rendered every select cell
// in the table on every key (92 updates per key on a 46-row table). Each
// cell's value is read through a zod schema, which returns a new array for
// a multi-select value whenever anything in the database changes.
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

test('typing in a text cell does not re-render the other rows’ select cells', async () => {
  await setupEditor('page');
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
  const rowIds = Array.from({ length: 6 }, () => dataSource.rowAdd('end'));
  const tagsId = dataSource.propertyAdd('end', {
    type: 'multi-select',
    name: 'Tags',
  })!;
  const notesId = dataSource.propertyAdd('end', {
    type: 'rich-text',
    name: 'Notes',
  })!;
  const tag = { id: 'tag-a', value: 'A', color: 'var(--affine-tag-blue)' };
  dataSource.propertyDataSet(tagsId, { options: [tag] });
  rowIds.forEach(id => dataSource.cellValueChange(id, tagsId, ['tag-a']));
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd('table'));
  await wait(300);

  const selectCell = dbEl.querySelector(
    'affine-database-multi-select-cell'
  ) as HTMLElement;
  expect(selectCell).toBeTruthy();
  const proto = Object.getPrototypeOf(selectCell) as {
    performUpdate: (...args: unknown[]) => unknown;
  };
  let updates = 0;
  const original = proto.performUpdate;
  proto.performUpdate = function (this: unknown, ...args: unknown[]) {
    updates++;
    return original.apply(this, args);
  };
  try {
    const cell = dbEl.querySelector(
      `data-view-table-row[data-row-id="${rowIds[0]}"] dv-table-view-cell-container[data-column-id="${notesId}"]`
    ) as HTMLElement;
    await userEvent.click(cell);
    await wait(100);
    await userEvent.click(cell);
    await wait(200);
    updates = 0;
    await userEvent.keyboard('hello');
    await wait(300);
    expect(
      (dataSource.cellValueGet(rowIds[0]!, notesId) as Text).toString()
    ).toBe('hello');
    expect(updates).toBe(0);
  } finally {
    proto.performUpdate = original;
  }
});
