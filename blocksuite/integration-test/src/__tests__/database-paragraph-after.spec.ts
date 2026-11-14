import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { BlockSelection } from '@blocksuite/affine/std';
import { Text } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-13 (inbox, 2026-11-13): with a heading straight after a database there
// is nowhere to put the cursor for a paragraph in between.
describe('a paragraph after a database block (F-13)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page');
    return cleanup;
  });

  test('selecting the database block and pressing Enter adds a paragraph after it', async () => {
    const noteId = addNote(doc);
    const databaseId = doc.addBlock(
      'affine:database',
      { title: new Text('Tasks') },
      noteId
    );
    doc.addBlock(
      'affine:paragraph',
      { type: 'h2', text: new Text('Next') },
      noteId
    );
    await wait(300);

    const std = editor.std;
    std.selection.setGroup('note', [
      std.selection.create(BlockSelection, { blockId: databaseId }),
    ]);
    await wait(100);
    (std.host as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    await wait(150);

    const children = doc.getModelById(noteId)!.children;
    const index = children.findIndex(child => child.id === databaseId);
    const after = children[index + 1];
    expect({
      flavour: after?.flavour,
      type: (after?.props as { type?: string } | undefined)?.type,
      text: (after?.props as { text?: Text } | undefined)?.text?.toString(),
    }).toEqual({ flavour: 'affine:paragraph', type: 'text', text: '' });
  });

  test('Escape from an editing cell reaches the block, and Enter adds a paragraph after it', async () => {
    const noteId = addNote(doc);
    const databaseId = doc.addBlock(
      'affine:database',
      { title: new Text('Tasks') },
      noteId
    );
    doc.addBlock(
      'affine:paragraph',
      { type: 'h2', text: new Text('Next') },
      noteId
    );
    await wait(200);
    const dataSource = new DatabaseBlockDataSource(
      doc.getModelById(databaseId)! as never
    );
    const rowId = dataSource.rowAdd('end');
    doc.updateBlock(doc.getModelById(rowId)!, { text: new Text('A') });
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
    await wait(100);
    await userEvent.click(richText);
    await wait(150);

    // editing -> cell -> row -> block
    for (let i = 0; i < 3; i++) {
      await userEvent.keyboard('{Escape}');
      await wait(150);
    }
    const selected = editor.std.selection.value.map(s => s.type);
    await userEvent.keyboard('{Enter}');
    await wait(150);

    const children = doc.getModelById(noteId)!.children;
    const after = children[children.findIndex(c => c.id === databaseId) + 1];
    expect({
      selected,
      after: after?.flavour,
      type: (after?.props as { type?: string })?.type,
    }).toEqual({
      selected: ['block'],
      after: 'affine:paragraph',
      type: 'text',
    });
  });
});
