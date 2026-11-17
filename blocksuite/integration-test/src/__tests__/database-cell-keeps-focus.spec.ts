import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { Text } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-06 (inbox, 2026-11-13): on a long page it took three clicks to edit a
// table cell. Traced live: after the click that starts editing, a late
// selection update (RangeBinding's async native-selection handler clearing
// text selections) made RangeBinding focus the editor host, taking focus
// out of the cell being edited, so typing went nowhere.
describe('a table cell being edited keeps focus when the selection updates', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page');
    return cleanup;
  });

  test('clearing text selections does not move focus out of the cell', async () => {
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
    const rowId = dataSource.rowAdd('end');
    doc.updateBlock(doc.getModelById(rowId)!, { text: new Text('Hello') });
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

    const richText = dbEl.querySelector(
      `data-view-table-row[data-row-id="${rowId}"] data-view-header-area-text rich-text`
    ) as HTMLElement;
    await userEvent.click(richText);
    await wait(150);
    await userEvent.click(richText);
    await wait(150);
    const inCell = () =>
      !!(document.activeElement as HTMLElement | null)?.closest?.(
        'data-view-header-area-text'
      );
    const before = inCell();

    // what RangeBinding's async native-selection handler does
    editor.std.selection.clear(['text']);
    await wait(150);

    expect({ before, after: inCell() }).toEqual({ before: true, after: true });
  });
});
