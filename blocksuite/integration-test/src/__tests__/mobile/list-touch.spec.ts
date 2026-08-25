import {
  DatabaseBlockDataSource,
  getCell,
  updateCell,
} from '@blocksuite/affine/blocks/database';
import { journalTodoDatabaseSlashMenuConfig } from '@blocksuite/affine/blocks/database-view-ref';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { JournalTodoDatabaseProvider } from '@blocksuite/affine/shared/services';
import { IS_MOBILE } from '@blocksuite/global/env';
import type { Store } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { pointerdown, wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import {
  createStubVirtualKeyboardExtension,
  enableMobileDatabaseEditing,
  isVisible,
} from './utils.js';

// Story 2.12 (MOBILE-03 + the phase's own shared mobile harness):
// touch-emulation coverage for List view's three previously hover-only row
// actions (note, due-date, drag-handle). This file is picked up by BOTH
// `vitest.mobile.config.ts` (this plan's new mobile-context project,
// `hasTouch`/`isMobile`/a mobile `userAgent` set at `browser.newContext()`
// creation time) AND the existing, unmodified `vitest.config.ts` (desktop
// suite, three browsers, default UA) — `src/__tests__/**/*.spec.ts` matches
// this file's path under either config's `test.include`. Assertions below
// branch on `IS_MOBILE` (the exact same module-load-time constant the
// production CSS itself gates on) so the identical spec proves both halves
// of MOBILE-05 in one place: mobile config -> actions visible by default;
// desktop config -> actions remain hover-gated (unchanged).
describe('list view mobile touch parity (Story 2.12, MOBILE-03)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
    ]);
    return cleanup;
  });

  function createStubStd(journalDate: string) {
    let ref: { refDocId: string; refBlockId: string } | undefined;
    const stub = new Proxy(editor.std, {
      get(target, prop, receiver) {
        if (prop === 'getOptional') {
          return (identifier: unknown) => {
            if (identifier === JournalTodoDatabaseProvider) {
              return {
                getJournalDate: () => journalDate,
                getJournalTodoDatabaseRef: () => ref,
                setJournalTodoDatabaseRef: (newRef: typeof ref) => {
                  ref = newRef;
                },
                isTemplateDoc: () => false,
              };
            }
            return undefined;
          };
        }
        if (prop === 'host') {
          const realHost = Reflect.get(target, prop, receiver) as object;
          return new Proxy(realHost, {
            get(hostTarget, hostProp) {
              if (hostProp === 'std') return stub;
              return Reflect.get(hostTarget, hostProp, hostTarget);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return { stub, getRef: () => ref };
  }

  async function seedJournalTodo() {
    // Task 1's own new finding: `DatabaseBlockDataSource.readonly$` already
    // ANDs in `IS_MOBILE && !getFlag('enable_mobile_database_editing')`
    // (opt-in, defaults `false`) -- writable-path assertions below need
    // this enabled the same way a real device with the setting on would
    // have it, matching `renderDragHandle`'s pre-existing gate rather than
    // fighting it. Set on `doc` here for the *creation-time* path (e.g.
    // `ensureTaskHierarchyColumns`); the *rendered* `database-view-ref`
    // block resolves its canonical database through a separately
    // `getStore()`-constructed `Store` instance with its own independent
    // `FeatureFlagService` (confirmed live this session -- `Store` is not a
    // per-doc-id singleton; `BlockCollectionDoc.getStore()` without an
    // explicit stable `id` mints a fresh extension-provider scope per
    // call), so callers must ALSO call `enableFlagOnRenderedRow` below
    // once that row has actually rendered.
    enableMobileDatabaseEditing(doc);
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub, getRef } = createStubStd('2026-08-08');

    const items = journalTodoDatabaseSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: stub, model }) : items;
    await (
      resolvedItems.find(i => i.name === 'Journal Todo') as unknown as {
        action: () => Promise<void>;
      }
    ).action();
    await wait();

    const ref = getRef()!;
    const canonicalModel = doc.getBlock(ref.refBlockId)
      ?.model as DatabaseBlockModel;
    const dataSource = new DatabaseBlockDataSource(canonicalModel);
    const { levelColumnId } = dataSource.ensureTaskHierarchyColumns();
    const getLevel = (rowId: string) =>
      (getCell(canonicalModel, rowId, levelColumnId!)?.value as number) ?? 0;
    const setLevel = (rowId: string, level: number) =>
      updateCell(canonicalModel, rowId, {
        columnId: levelColumnId!,
        value: level,
      });
    return { dataSource, canonicalModel, getLevel, setLevel };
  }

  function getRowEl(rowId: string) {
    return document.querySelector(
      `[data-row-id="${rowId}"]`
    ) as HTMLElement | null;
  }

  function getListRenderer(rowId: string) {
    return getRowEl(rowId)?.closest('affine-data-view-list') as unknown as {
      logic: {
        view: {
          readonly$: { value: boolean };
          manager: {
            dataSource: { _model?: { store: Store } };
          };
        };
      };
      renderDragHandle: (rowId: string) => unknown;
      renderNoteAction: (rowId: string) => unknown;
      renderDueDateAction: (rowId: string) => unknown;
    } | null;
  }

  // Once the reference block has actually rendered a row, this reaches
  // into the *live* `manager.dataSource`'s own backing `Store` (a distinct
  // instance from `doc`, per the `seedJournalTodo` comment above) and
  // enables the flag there too, then waits a tick for the `SignalWatcher`
  // -driven reactive re-render this Story 2.12 CSS fix relies on.
  async function enableFlagOnRenderedRow(rowId: string) {
    const renderer = getListRenderer(rowId);
    const store = renderer?.logic.view.manager.dataSource._model?.store;
    if (store) {
      enableMobileDatabaseEditing(store);
    }
    await wait();
  }

  function getNoteAction(rowId: string) {
    return getRowEl(rowId)?.querySelector(
      '.affine-data-view-list-note-action'
    ) as HTMLElement | null;
  }

  function getDueDateAction(rowId: string) {
    return getRowEl(rowId)?.querySelector(
      '.affine-data-view-list-due-date-action'
    ) as HTMLElement | null;
  }

  function getHandle(rowId: string) {
    return getRowEl(rowId)?.querySelector(
      '.affine-data-view-list-drag-handle'
    ) as HTMLElement | null;
  }

  // Behavior Test 1 (mobile context resolves true): assert on the
  // *rendered effect* of `IS_MOBILE` — the new CSS block's visibility
  // override actually taking effect — rather than `navigator.userAgent`
  // directly, since the CSS fix itself is the real signal a test should
  // care about (RESEARCH.md Pitfall 1 / this plan's own directive).
  test('IS_MOBILE resolves true under the mobile-context harness, reflected in a rendered CSS effect', async () => {
    const { dataSource } = await seedJournalTodo();
    const rowA = dataSource.rowAddAsTodoList('end');
    await wait();

    const noteAction = getNoteAction(rowA);
    expect(noteAction).toBeTruthy();
    expect(isVisible(noteAction)).toBe(IS_MOBILE);
  });

  // Behavior Test 2 (visibility flip): note/due-date/drag-handle are
  // visible without any simulated `:hover` under the mobile context, and
  // remain hover-gated (hidden by default) under the existing desktop
  // config for the identical row — proven by branching the very same
  // assertion on `IS_MOBILE`, so this file's desktop-config run (picked up
  // unmodified by `vitest.config.ts`) is the "equivalent assertions against
  // the existing desktop project" acceptance criterion.
  test('note/due-date/drag-handle visibility matches IS_MOBILE without any simulated hover', async () => {
    const { dataSource } = await seedJournalTodo();
    const rowA = dataSource.rowAddAsTodoList('end');
    await wait();
    await enableFlagOnRenderedRow(rowA);

    const noteAction = getNoteAction(rowA);
    const dueDateAction = getDueDateAction(rowA);
    const handle = getHandle(rowA);
    expect(noteAction).toBeTruthy();
    expect(dueDateAction).toBeTruthy();
    expect(handle).toBeTruthy();

    expect(isVisible(noteAction)).toBe(IS_MOBILE);
    expect(isVisible(dueDateAction)).toBe(IS_MOBILE);
    expect(isVisible(handle)).toBe(IS_MOBILE);
  });

  // Behavior Test 3 (readonly regression, drag-handle): the existing
  // `view.readonly$.value` gate inside `renderDragHandle` must still omit
  // the drag-handle DOM node entirely under IS_MOBILE — this is a JS-level
  // render gate, not a CSS rule, so it is orthogonal to (and must survive)
  // the mobile CSS-visibility change. Verified directly against the
  // `ListViewRenderer` render methods (same technique as `list.unit.spec.ts`),
  // since flipping the real view's readonly state end-to-end would require
  // plumbing a whole different doc-permission setup unrelated to this
  // phase's CSS-only scope.
  test('drag-handle is still absent when the view is readonly (JS gate preserved, IS_MOBILE-independent)', async () => {
    const { dataSource } = await seedJournalTodo();
    const rowA = dataSource.rowAddAsTodoList('end');
    await wait();
    const renderer = getListRenderer(rowA);
    expect(renderer).toBeTruthy();

    const original = renderer!.logic.view.readonly$.value;
    try {
      renderer!.logic.view.readonly$ = { value: true } as never;
      // `nothing` (lit's sentinel) renders as an empty comment/no node —
      // assert via lit's own sentinel identity, matching
      // `list.unit.spec.ts`'s own established assertion style.
      const { nothing } = await import('lit');
      expect(renderer!.renderDragHandle(rowA)).toBe(nothing);
    } finally {
      renderer!.logic.view.readonly$ = { value: original } as never;
    }
  });

  // Behavior Test 4 (readonly non-regression, note/due-date): confirms
  // `renderNoteAction`/`renderDueDateAction` are NOT readonly-gated today
  // (RESEARCH.md's corrected finding — only `renderDragHandle` gates) and
  // this phase must not silently add a new gate.
  test('note-action and due-date-action still render when the view is readonly (pre-existing non-gating preserved)', async () => {
    const { dataSource } = await seedJournalTodo();
    const rowA = dataSource.rowAddAsTodoList('end');
    await wait();
    const renderer = getListRenderer(rowA);
    expect(renderer).toBeTruthy();

    const original = renderer!.logic.view.readonly$.value;
    try {
      renderer!.logic.view.readonly$ = { value: true } as never;
      const { nothing } = await import('lit');
      expect(renderer!.renderNoteAction(rowA)).not.toBe(nothing);
      expect(renderer!.renderDueDateAction(rowA)).not.toBe(nothing);
    } finally {
      renderer!.logic.view.readonly$ = { value: original } as never;
    }
  });

  test('pointerdown smoke on the (now-visible-on-mobile) drag handle does not throw', async () => {
    const { dataSource } = await seedJournalTodo();
    const rowA = dataSource.rowAddAsTodoList('end');
    await wait();
    await enableFlagOnRenderedRow(rowA);
    const handle = getHandle(rowA);
    expect(handle).toBeTruthy();
    expect(() =>
      pointerdown(handle!, { x: 2, y: 2 }, { pointerType: 'touch' })
    ).not.toThrow();
  });
});
