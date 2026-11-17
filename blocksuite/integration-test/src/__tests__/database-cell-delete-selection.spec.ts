import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { Text } from '@blocksuite/store';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-07 (live session 2026-11-17): in a multi-line Notes cell, selecting
// from the first character and pressing Backspace deleted the wrong text;
// the same selection in a paragraph was fine.
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

const NOTES = 'Line one\nLine two\nLine three';
// the live case: blank lines between paragraphs
const LIVE_NOTES =
  'Lets make this a very very\nlong cell and see\n\nSentence over multiple\n\nhow about this\n\nAnd we will leave one below';

async function setup(notesText = NOTES) {
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
  const rowId = dataSource.rowAdd('end');
  const notesId = dataSource.propertyAdd('end', {
    type: 'rich-text',
    name: 'Notes',
  })!;
  dataSource.cellValueChange(rowId, notesId, new Text(notesText));
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd('table'));
  await wait(300);
  const cell = dbEl.querySelector(
    `data-view-table-row[data-row-id="${rowId}"] dv-table-view-cell-container[data-column-id="${notesId}"]`
  ) as HTMLElement;
  await userEvent.click(cell);
  await wait(100);
  await userEvent.click(cell);
  await wait(200);
  const textNodes = () => {
    const root = cell.querySelector('[data-v-root]')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: globalThis.Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as globalThis.Text;
      if (t.parentElement?.closest('v-text') && t.data.trim()) nodes.push(t);
    }
    return nodes;
  };
  const notes = () =>
    (dataSource.cellValueGet(rowId, notesId) as Text | undefined)?.toString();
  return { textNodes, notes };
}

describe('database cell: deleting a selection that starts at the first character (F-07)', () => {
  for (const direction of ['forward', 'backward'] as const) {
    for (const [what, endLine, expected] of [
      ['to the end of the second line', 1, '\nLine three'],
      ['to the end of the last line', 2, ''],
    ] as const) {
      test(`${direction} selection from the first character ${what}`, async () => {
        const { textNodes, notes } = await setup();
        const nodes = textNodes();
        expect(nodes.map(n => n.data)).toEqual(NOTES.split('\n'));
        const start = nodes[0]!;
        const end = nodes[endLine]!;
        const selection = getSelection()!;
        if (direction === 'forward') {
          selection.setBaseAndExtent(start, 0, end, end.length);
        } else {
          selection.setBaseAndExtent(end, end.length, start, 0);
        }
        await wait(100);
        await userEvent.keyboard('{Backspace}');
        await wait(200);
        expect(notes()).toBe(expected);
      });
    }
  }

  for (const direction of ['forward', 'backward'] as const) {
    test(`${direction} selection over blank lines, from the first character to "how about this"`, async () => {
      const { textNodes, notes } = await setup(LIVE_NOTES);
      const nodes = textNodes();
      const start = nodes.find(n => n.data.startsWith('Lets'))!;
      const end = nodes.find(n => n.data === 'how about this')!;
      const selection = getSelection()!;
      if (direction === 'forward') {
        selection.setBaseAndExtent(start, 0, end, end.length);
      } else {
        selection.setBaseAndExtent(end, end.length, start, 0);
      }
      await wait(100);
      await userEvent.keyboard('{Backspace}');
      await wait(200);
      expect(notes()).toBe('\n\nAnd we will leave one below');
    });
  }

  // Firefox reports the delete's target range on the editor root element
  // (root, child index) rather than on text nodes; that boundary was read
  // as "end of the first line", so only the first line was deleted.
  for (const [from, expected] of [
    ['Lets', '\n\nAnd we will leave one below'],
    // live case 2: from the second line; worked before (both ends resolved
    // to the same point, so the target range was ignored)
    ['long', 'Lets make this a very very\n\n\nAnd we will leave one below'],
  ] as const) {
    test(`a delete whose target range is given on the editor root element (Firefox), from "${from}"`, async () => {
      const { textNodes, notes } = await setup(LIVE_NOTES);
      const nodes = textNodes();
      const start = nodes.find(n => n.data.startsWith(from))!;
      const end = nodes.find(n => n.data === 'how about this')!;
      getSelection()!.setBaseAndExtent(end, end.length, start, 0);
      await wait(100);
      const root = start.parentElement!.closest('[data-v-root]')!;
      const children = Array.from(root.childNodes);
      const endLine = children.findIndex(child => child.contains(end));
      const startLine = children.findIndex(child => child.contains(start));
      const event = new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        bubbles: true,
        cancelable: true,
        composed: true,
        targetRanges: [
          new StaticRange({
            startContainer: root,
            startOffset: startLine,
            endContainer: root,
            endOffset: endLine + 1,
          }),
        ],
      });
      root.dispatchEvent(event);
      await wait(200);
      expect(notes()).toBe(expected);
    });
  }
});
