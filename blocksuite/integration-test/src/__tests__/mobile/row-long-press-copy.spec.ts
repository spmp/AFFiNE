import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import { Text } from '@blocksuite/store';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import * as mobileUtils from './utils.js';
import { enableMobileDatabaseEditing, touchTap } from './utils.js';

// The mobile keyboard toolbar (pr/30) needs a virtual keyboard provider; its
// stub helpers only exist where that toolbar does.
const keyboardStub = mobileUtils as {
  registerStubVirtualKeyboardProviderForAllScopes?: () => void;
  unregisterStubVirtualKeyboardProviderForAllScopes?: () => void;
};

// F-11 on mobile (2026-11-17): long-press a row to start selecting rows,
// tap rows to add or remove them, then Copy from the bar at the bottom.
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

async function longPress(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const opts = {
    clientX: rect.left + 8,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
    composed: true,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
  };
  target.dispatchEvent(new PointerEvent('pointerdown', opts));
  await wait(650);
  target.dispatchEvent(new PointerEvent('pointerup', opts));
  await wait(100);
}

async function setup(view: 'list' | 'table') {
  enableMobileDatabaseEditing(doc);
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
  const rowIds = ['A', 'B', 'C'].map(title => {
    const id = dataSource.rowAddAsTodoList('end');
    doc.updateBlock(doc.getModelById(id)!, { text: new Text(title) });
    return id;
  });
  const dbEl = document.querySelector(
    `affine-database[data-block-id="${databaseId}"]`
  ) as DbElement;
  const vm = dbEl.dataSource.value.viewManager;
  vm.setCurrentView(vm.viewAdd(view));
  await wait(400);
  const row = (id: string) =>
    (view === 'list'
      ? dbEl.querySelector(`.affine-data-view-list-row[data-row-id="${id}"]`)
      : dbEl.querySelector(
          `mobile-table-row[data-row-id="${id}"]`
        )) as HTMLElement;
  const selected = () =>
    rowIds.filter(id => row(id)?.dataset.selected === 'true');
  const bar = () =>
    document.querySelector(
      'affine-mobile-row-select-bar'
    ) as HTMLElement | null;
  const button = (label: string) =>
    Array.from(bar()?.querySelectorAll('button') ?? []).find(
      b => b.textContent?.trim() === label
    ) as HTMLElement | undefined;
  return { rowIds, row, selected, bar, button };
}

describe('mobile: long-press to select rows, then copy', () => {
  beforeEach(async () => {
    written = {};
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      for (const item of items) {
        for (const type of item.types) {
          written[type] = await (await item.getType(type)).text();
        }
      }
    };
    keyboardStub.registerStubVirtualKeyboardProviderForAllScopes?.();
    const cleanup = await setupEditor('page');
    return async () => {
      await cleanup();
      keyboardStub.unregisterStubVirtualKeyboardProviderForAllScopes?.();
    };
  });
  afterEach(() => {
    navigator.clipboard.write = originalWrite;
    document.querySelector('affine-mobile-row-select-bar')?.remove();
  });

  for (const view of ['list', 'table'] as const) {
    test(`${view} view: long-press selects, taps add, Copy copies, Done ends`, async () => {
      const { rowIds, row, selected, bar, button } = await setup(view);
      const [a, b, c] = rowIds as [string, string, string];
      expect(row(a)).toBeTruthy();

      await longPress(row(a));
      expect(selected()).toEqual([a]);
      expect(bar()?.textContent).toContain('1 selected');

      touchTap(row(c));
      await wait(100);
      expect(selected()).toEqual([a, c]);
      touchTap(row(c));
      await wait(100);
      touchTap(row(b));
      await wait(100);
      expect(selected()).toEqual([a, b]);

      button('Copy')!.click();
      await wait(300);
      const text = written['text/plain'] ?? '';
      expect(text).toContain('A');
      expect(text).toContain('B');
      expect(text).not.toContain('C');

      // Copy as text is a long-press on Copy (no room for another button):
      // plain text only, so AFFiNE pastes it as Markdown
      expect(button('Copy as text')).toBeUndefined();
      written = {};
      await longPress(button('Copy')!);
      // iOS only allows a clipboard write in the release (live, 2026-11-17:
      // a write from the hold timer was rejected), so nothing yet; the
      // button says what releasing will do
      expect(written).toEqual({});
      expect(button('Copy as text')).toBeTruthy();
      button('Copy as text')!.click(); // the release
      await wait(300);
      expect(Object.keys(written)).toEqual(['text/plain']);
      expect(written['text/plain']).toContain(
        view === 'list' ? '- [ ] A' : '| A'
      );

      button('Done')!.click();
      await wait(100);
      expect({ selected: selected(), bar: !!bar() }).toEqual({
        selected: [],
        bar: false,
      });
    });
  }

  test('a short tap does not start selecting', async () => {
    const { rowIds, row, selected, bar } = await setup('list');
    touchTap(row(rowIds[0]!));
    await wait(700);
    expect({ selected: selected(), bar: !!bar() }).toEqual({
      selected: [],
      bar: false,
    });
  });
});
