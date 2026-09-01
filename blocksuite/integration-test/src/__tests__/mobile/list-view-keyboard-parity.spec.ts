import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import {
  createStubVirtualKeyboardExtension,
  enableMobileDatabaseEditing,
} from './utils.js';

// Phase 3 (LIST-01..04): database List-view rows currently opt out of
// BlockSuite's keymap system entirely (`data-not-block-text`, no
// `data-block-id`), so the already-correct native `ListKeymapExtension`/
// `ParagraphKeymapExtension` never engage for them. This suite proves
// `ListViewRenderer.onRowKeyDown` now reuses those native commands directly
// for Backspace/Delete/Enter, matching native `affine:list`/`affine:paragraph`
// editing behavior end-to-end.
//
// Deviation from the plan's literal file path (`src/__tests__/list-view-
// keyboard-parity.spec.ts`, top-level): `vitest.mobile.config.ts`'s own
// `test.include` only globs `src/__tests__/mobile/**/*.spec.ts` (confirmed
// live: `yarn test:mobile` against the top-level path reports "No test
// files found, exiting with code 1"), while the desktop config's glob is
// the broader `src/__tests__/**/*.spec.ts` and already covers this
// `mobile/` subdirectory -- exactly the existing dual-context pattern this
// package already established for `mobile/keyboard-toolbar-indent-touch.
// spec.ts` and siblings. Moved here (Rule 3 auto-fix, blocking issue) so
// both `yarn test:unit` and `yarn test:mobile` actually execute this file,
// matching the plan's own `<verify>` requirement.
//
// `createStubVirtualKeyboardExtension`/`enableMobileDatabaseEditing` mirror
// `keyboard-toolbar-indent-touch.spec.ts`'s own setup: the mobile page spec
// unconditionally resolves `VirtualKeyboardProvider` (needs the stub), and
// `DatabaseBlockDataSource.readonly$` ANDs in `IS_MOBILE &&
// !getFlag('enable_mobile_database_editing')` -- without opting in, every
// mutating branch under test would silently no-op under the mobile-context
// run specifically (readonly gate), while passing under desktop by
// coincidence. Both calls are no-ops on desktop (`IS_MOBILE` is `false`
// there regardless of the flag), so this setup is safe for both configs.

type InlineEditorLike = {
  setInlineRange: (range: { index: number; length: number }) => void;
  getInlineRange: () => { index: number; length: number } | null;
};

type RichTextElement = HTMLElement & {
  inlineEditor?: InlineEditorLike;
};

async function seedListView(rowCount: number) {
  enableMobileDatabaseEditing(doc);
  const noteId = addNote(doc);
  const databaseId = doc.addBlock('affine:database', {}, noteId);
  await wait();

  const dbModel = doc.getModelById(databaseId) as DatabaseBlockModel;
  const dataSource = new DatabaseBlockDataSource(dbModel);

  const rowIds: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    rowIds.push(dataSource.rowAddAsTodoList('end'));
  }
  await wait();

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
  const listViewId = dbEl.dataSource.value.viewManager.viewAdd('list');
  dbEl.dataSource.value.viewManager.setCurrentView(listViewId);
  await wait(500);

  return { dataSource, dbModel, dbEl, rowIds };
}

function getRowEl(dbEl: HTMLElement, rowId: string) {
  return dbEl.querySelector(
    `.affine-data-view-list-row[data-row-id="${rowId}"]`
  ) as HTMLElement;
}

async function setRowText(rowId: string, text: string) {
  const model = doc.getModelById(rowId);
  if (!model?.text) {
    throw new Error(`row ${rowId} has no text`);
  }
  model.text.insert(text, 0);
  await wait();
}

async function focusRowAt(rowEl: HTMLElement, index: number) {
  const richText = rowEl.querySelector('rich-text') as RichTextElement | null;
  expect(richText).toBeTruthy();
  const withUpdateComplete = richText as unknown as {
    updateComplete: Promise<boolean>;
  };
  await withUpdateComplete.updateComplete;
  const inlineEditor = richText!.inlineEditor;
  expect(inlineEditor).toBeTruthy();
  inlineEditor!.setInlineRange({ index, length: 0 });
  await wait();
  return richText!;
}

function dispatchKey(
  target: HTMLElement,
  key: string,
  opts: Partial<KeyboardEventInit> = {}
) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...opts,
    })
  );
}

describe('database List-view keyboard editing parity (Phase 3, LIST-01..04)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
    ]);
    return cleanup;
  });

  test('Backspace at index 0 of a non-first row deletes it, joins its text into the previous row, and focuses the previous row', async () => {
    const { dbEl, rowIds } = await seedListView(2);
    const [row1, row2] = rowIds;
    await setRowText(row1, 'hello');
    await setRowText(row2, 'world');

    const row2El = getRowEl(dbEl, row2);
    await focusRowAt(row2El, 0);

    dispatchKey(row2El, 'Backspace');
    await wait(200);

    expect(doc.getModelById(row2)).toBeFalsy();
    const row1Model = doc.getModelById(row1);
    expect(row1Model?.text?.toString()).toBe('helloworld');
    const row1El = getRowEl(dbEl, row1);
    expect(row1El.contains(document.activeElement)).toBe(true);
  });

  test('Backspace at index 0 of the FIRST row does nothing (no cross-container leak)', async () => {
    const { dbModel, dbEl, rowIds } = await seedListView(1);
    const [row1] = rowIds;
    await setRowText(row1, 'hello');

    const row1El = getRowEl(dbEl, row1);
    await focusRowAt(row1El, 0);

    dispatchKey(row1El, 'Backspace');
    await wait(200);

    const model = doc.getModelById(row1);
    expect(model).toBeTruthy();
    expect(model?.text?.toString()).toBe('hello');
    expect(dbModel.children.length).toBe(1);
  });

  test('Delete at end-of-text with a next row present merges the next row backward, keeping the cursor at the join point', async () => {
    const { dbEl, rowIds } = await seedListView(2);
    const [row1, row2] = rowIds;
    await setRowText(row1, 'hello');
    await setRowText(row2, 'world');

    const row1El = getRowEl(dbEl, row1);
    await focusRowAt(row1El, 'hello'.length);

    dispatchKey(row1El, 'Delete');
    await wait(200);

    expect(doc.getModelById(row2)).toBeFalsy();
    const row1Model = doc.getModelById(row1);
    expect(row1Model?.text?.toString()).toBe('helloworld');
    expect(row1El.contains(document.activeElement)).toBe(true);
  });

  test('Delete at end-of-text on the LAST row does nothing', async () => {
    const { dbModel, dbEl, rowIds } = await seedListView(2);
    const [row1, row2] = rowIds;
    await setRowText(row1, 'hello');
    await setRowText(row2, 'world');

    const row2El = getRowEl(dbEl, row2);
    await focusRowAt(row2El, 'world'.length);

    dispatchKey(row2El, 'Delete');
    await wait(200);

    const model = doc.getModelById(row2);
    expect(model).toBeTruthy();
    expect(model?.text?.toString()).toBe('world');
    expect(dbModel.children.length).toBe(2);
  });
});
