import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { Text } from '@blocksuite/store';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import { wait } from './utils/common.js';
import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// F-08 (live, 2026-11-17): typing in a large multi-line cell re-rendered
// every line on every key (~2,000 line/element updates per key for 1,000
// lines), so typing slowed as the cell grew. Lines whose text and position
// didn't change should not update.
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

const LINES = 300;

async function setup() {
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
  const text = Array.from({ length: LINES }, (_, i) => `Line ${i}`).join('\n');
  dataSource.cellValueChange(rowId, notesId, new Text(text));
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
  await wait(300);
  const root = cell.querySelector('[data-v-root]') as HTMLElement;
  const line = root.querySelector('v-line')!;
  const element = root.querySelector('v-element')!;
  const counts = { lines: 0, elements: 0 };
  const restore: (() => void)[] = [];
  for (const [el, key] of [
    [line, 'lines'],
    [element, 'elements'],
  ] as const) {
    const proto = Object.getPrototypeOf(el) as {
      performUpdate: (...args: unknown[]) => unknown;
    };
    const original = proto.performUpdate;
    proto.performUpdate = function (this: unknown, ...args: unknown[]) {
      counts[key]++;
      return original.apply(this, args);
    };
    restore.push(() => (proto.performUpdate = original));
  }
  const textNode = (lineIndex: number) => {
    const target = root.querySelectorAll('v-line')[lineIndex]!;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as globalThis.Text | null;
    while (node && !node.data.trim()) node = walker.nextNode() as globalThis.Text | null;
    return node!;
  };
  const placeCaret = async (lineIndex: number) => {
    const node = textNode(lineIndex);
    getSelection()!.setBaseAndExtent(node, node.length, node, node.length);
    await wait(150);
  };
  const notes = () =>
    (dataSource.cellValueGet(rowId, notesId) as Text).toString();
  return {
    counts,
    placeCaret,
    notes,
    restore: () => restore.forEach(f => f()),
  };
}

test('typing at the end of a large cell updates only the line being typed in', async () => {
  const { counts, placeCaret, notes, restore } = await setup();
  try {
    await placeCaret(LINES - 1);
    counts.lines = counts.elements = 0;
    await userEvent.keyboard('abc');
    await wait(300);
    expect(notes().endsWith(`Line ${LINES - 1}abc`)).toBe(true);
    // 3 keys: at most a couple of updates per key, not ~300 per key
    expect(counts.lines).toBeLessThanOrEqual(6);
    expect(counts.elements).toBeLessThanOrEqual(6);
  } finally {
    restore();
  }
});

test('typing in the middle of a large cell leaves the lines before it alone', async () => {
  const { counts, placeCaret, notes, restore } = await setup();
  try {
    await placeCaret(LINES / 2);
    counts.lines = counts.elements = 0;
    await userEvent.keyboard('x');
    await wait(300);
    expect(notes()).toContain(`Line ${LINES / 2}x`);
    // the lines after the caret move (their offsets change); the ones
    // before it don't update
    expect(counts.lines).toBeLessThanOrEqual(LINES / 2 + 2);
  } finally {
    restore();
  }
});
