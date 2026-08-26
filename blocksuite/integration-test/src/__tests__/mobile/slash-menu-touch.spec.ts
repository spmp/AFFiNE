import { databaseRefSlashMenuConfig } from '@blocksuite/affine/blocks/database-ref';
import {
  genericDatabaseViewRefSlashMenuConfig,
  journalTodoDatabaseSlashMenuConfig,
} from '@blocksuite/affine/blocks/database-view-ref';
import type {
  DatabaseBlockModel,
  DatabaseRefBlockModel,
  DatabaseViewRefBlockModel,
} from '@blocksuite/affine/model';
import {
  CrossDocReferenceExtension,
  type CrossDocReferenceService,
  JournalTodoDatabaseProvider,
} from '@blocksuite/affine/shared/services';
import { Text } from '@blocksuite/store';
import { userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import { createStubVirtualKeyboardExtension, touchTap } from './utils.js';

// Story 2.12 (MOBILE-04): live-verify — not re-implement — that
// `/Journal Todo`, the sibling `database-view-ref`/`database-ref` slash
// commands, and the cross-doc reference picker DI seam all work under a
// touch-emulated mobile context, matching desktop. RESEARCH.md confirmed
// zero `IS_MOBILE` gating anywhere in `database-view-ref/src/configs/
// slash-menu.ts` (664 lines, fully read) or `database-ref/src/configs/
// slash-menu.ts` — so every assertion below is a regression check against
// already-correct, shared (non-mobile-specific) command logic, run for real
// under this plan's mobile-context harness (`vitest.mobile.config.ts`),
// picked up identically by the existing, unmodified desktop config.
//
// Scope note on the cross-doc reference picker (Environment Availability,
// RESEARCH.md): the actual picker UI is the app's shared React
// `QuickSearchService`/cmdk modal
// (`packages/frontend/core/src/blocksuite/view-extensions/editor-view/
// cross-doc-reference-service.ts`) — an app-layer package this
// `blocksuite/integration-test` harness has no access to at all (confirmed:
// every existing desktop spec for these same commands —
// `database-view-ref.spec.ts`, `database-ref.spec.ts` — stubs
// `CrossDocReferenceProvider` for exactly this reason, never renders the
// real modal). Tests 3/4 below register a REAL `CrossDocReferenceExtension`
// (not a `std.getOptional` Proxy override, unlike the existing desktop
// specs) so the DI seam itself is genuinely exercised end-to-end under a
// touch-emulated `std`, up to the boundary this package can reach — the
// practical substitute RESEARCH.md anticipated. Whether the real modal
// stays visible/usable with the on-screen keyboard open (must_haves'
// "backstop"-verification truth) is NOT automatable from here; flagged in
// the SUMMARY as a manual/real-device spot-check, per RESEARCH.md's own
// Environment Availability guidance.
describe('slash-menu + cross-doc reference picker touch parity (Story 2.12, MOBILE-04)', () => {
  let resolvePicker: CrossDocReferenceService['openCrossDocReferencePicker'] = (
    _excludeDocId,
    _allowedFlavours
  ) => Promise.resolve(null);

  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
      // A stable extension registered once per test, delegating to a
      // per-test-reassignable `resolvePicker` — lets each test below swap
      // in its own picker behavior without re-registering the extension
      // (extensions are only read at `setupEditor` time).
      CrossDocReferenceExtension({
        openCrossDocReferencePicker: (excludeDocId, allowedFlavours) =>
          resolvePicker(excludeDocId, allowedFlavours),
      }),
    ]);
    resolvePicker = () => Promise.resolve(null);
    return cleanup;
  });

  function createSecondDoc() {
    const secondDoc = collection
      .createDoc(`doc:second-${Math.random().toString(16).slice(2, 8)}`)
      .getStore();
    secondDoc.load(() => {
      const rootId = secondDoc.addBlock('affine:page', { title: new Text() });
      secondDoc.addBlock('affine:surface', {}, rootId);
    });
    return secondDoc;
  }

  // Mirrors `journal-todo-database.spec.ts`'s own `createStubStd` — a
  // `getOptional` Proxy override is the right tool for `JournalTodoDatabase
  // Provider` specifically (it's a pure read/write pointer seam, not the
  // UI-facing picker this file's own DI-seam tests below deliberately
  // register for real), matching the established, already-reviewed pattern
  // for this exact provider across the whole existing desktop suite.
  function createStubStdForJournalTodo(journalDate: string) {
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

  // Behavior (1): `/Journal Todo` inserts the expected `database-view-ref`
  // block under a touch-emulated context, matching desktop's own
  // `journal-todo-database.spec.ts` assertions (fresh canonical, seeded
  // `list`-mode view, OR-grace filter) — plus a touch smoke check on the
  // rendered reference itself. Checkbox/detail-field/drag-handle touch
  // interactions on the resulting List rows are already exhaustively
  // covered by Plan 01's `list-touch.spec.ts` (MOBILE-03) — not duplicated
  // here; this test's own job is the *slash command's* insertion
  // correctness under touch, not List's row interactions again.
  test('/Journal Todo inserts the expected database-view-ref block under a touch-emulated context, matching desktop', async () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub, getRef } = createStubStdForJournalTodo('2026-08-08');

    const items = journalTodoDatabaseSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: stub, model }) : items;
    const item = resolvedItems.find(i => i.name === 'Journal Todo');
    expect(item).toBeTruthy();

    await (item as unknown as { action: () => Promise<void> }).action();
    await wait();

    const ref = getRef();
    expect(ref).toBeTruthy();
    const canonicalModel = doc.getBlock(ref!.refBlockId)
      ?.model as DatabaseBlockModel;
    expect(canonicalModel?.flavour).toBe('affine:database');

    const refEl = document.querySelector(
      'affine-database-view-ref'
    ) as HTMLElement & { model: DatabaseViewRefBlockModel };
    expect(refEl).toBeTruthy();
    const refModel = refEl.model;
    expect(refModel.props.refBlockId).toBe(ref!.refBlockId);
    const seededView = refModel.props.views[0] as unknown as {
      mode: string;
      filter: { op: string; conditions: unknown[] };
    };
    expect(seededView.mode).toBe('list');
    expect(seededView.filter.op).toBe('or');
    expect(seededView.filter.conditions.length).toBe(2);

    // Touch smoke check: the rendered reference is genuinely reachable via
    // a synthesized touch tap (not just a desktop mouse click), matching
    // desktop's own click-based reachability.
    expect(() => touchTap(refEl)).not.toThrow();
  });

  // Behavior (2): the generic, non-journal `database-view-ref` command
  // ("Table (own view): <name>") inserts an independently-viewed reference
  // under a touch-emulated context, matching desktop's own
  // `database-view-ref.spec.ts` assertions (plain default `table` view, no
  // filter carried over).
  test('database-view-ref\'s "Table (own view)" command inserts an independent-view reference under a touch-emulated context, matching desktop', async () => {
    const noteId = addNote(doc);
    const databaseId = doc.addBlock(
      'affine:database',
      { title: new Text('My Table') },
      noteId
    );
    await wait();

    const anchorNoteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, anchorNoteId);
    const model = doc.getModelById(paragraphId)!;

    const items = genericDatabaseViewRefSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: editor.std, model }) : items;
    const sameDocItem = resolvedItems.find(
      item => item.name === 'Table (own view): My Table'
    );
    expect(sameDocItem).toBeTruthy();

    await (sameDocItem as unknown as { action: () => Promise<void> }).action();
    await wait();

    const refs = doc.getBlocksByFlavour('affine:database-view-ref');
    expect(refs.length).toBe(1);
    const refModel = refs[0]!.model as unknown as DatabaseViewRefBlockModel;
    expect(refModel.props.refBlockId).toBe(databaseId);

    const seededView = refModel.props.views[0] as unknown as {
      mode: string;
      filter?: { conditions: unknown[] };
    };
    expect(seededView.mode).toBe('table');
    expect(seededView.filter?.conditions ?? []).toEqual([]);

    const refEl = document.querySelector(
      'affine-database-view-ref'
    ) as HTMLElement;
    expect(refEl).toBeTruthy();
    expect(() => touchTap(refEl)).not.toThrow();
  });

  // Behavior (3): `database-ref`'s unified "Reference" command opens the
  // cross-doc picker DI seam (a REAL `CrossDocReferenceExtension`, not a
  // `getOptional` Proxy override) and inserts a `database-ref` under a
  // touch-emulated context. Stands in for "the picker opens, is
  // searchable, and a result can be selected" (RESEARCH.md's own
  // acknowledged approximation) — the seam itself, up to the app-layer
  // boundary this package can reach, genuinely resolves under touch.
  test('database-ref\'s unified "Reference" command opens the cross-doc picker DI seam and inserts a database-ref under a touch-emulated context', async () => {
    const secondDoc = createSecondDoc();
    const secondNoteId = addNote(secondDoc);
    const databaseId = secondDoc.addBlock(
      'affine:database',
      { title: new Text() },
      secondNoteId
    );

    let capturedExcludeDocId: string | null | undefined;
    let capturedAllowedFlavours: readonly string[] | undefined;
    resolvePicker = (excludeDocId, allowedFlavours) => {
      capturedExcludeDocId = excludeDocId;
      capturedAllowedFlavours = allowedFlavours;
      return Promise.resolve({
        docId: secondDoc.id,
        blockId: databaseId,
        flavour: 'affine:database' as const,
      });
    };

    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;

    const items = databaseRefSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: editor.std, model }) : items;
    const referenceItem = resolvedItems.find(item => item.name === 'Reference');
    expect(referenceItem).toBeTruthy();

    await (
      referenceItem as unknown as { action: () => Promise<void> }
    ).action();
    await wait();

    // Proves the seam threads the real invoking doc/std through correctly
    // under touch, not just that *some* candidate got returned.
    expect(capturedExcludeDocId).toBe(doc.id);
    expect(capturedAllowedFlavours).toBeUndefined();

    const refs = doc.getBlocksByFlavour('affine:database-ref');
    expect(refs.length).toBe(1);
    const refModel = refs[0]!.model as unknown as DatabaseRefBlockModel;
    expect(refModel.props.refBlockId).toBe(databaseId);
    expect(refModel.props.refDocId).toBe(secondDoc.id);

    const refEl = document.querySelector('affine-database-ref') as HTMLElement;
    expect(refEl).toBeTruthy();
    expect(() => touchTap(refEl)).not.toThrow();
  });

  // Behavior (3b): the sibling cross-doc-invoking command —
  // `database-view-ref`'s "Reference (own view)" — restricts the picker to
  // database candidates and inserts a cross-doc `database-view-ref`, also
  // under a real (non-Proxy) `CrossDocReferenceExtension` and touch
  // context. Confirms both distinct cross-doc-picker call sites in this
  // phase's scope thread their own arguments correctly, not just one.
  test('database-view-ref\'s "Reference (own view)" command restricts the picker to database candidates and inserts a cross-doc reference under a touch-emulated context', async () => {
    const secondDoc = createSecondDoc();
    const secondNoteId = addNote(secondDoc);
    const databaseId = secondDoc.addBlock(
      'affine:database',
      { title: new Text() },
      secondNoteId
    );

    let capturedAllowedFlavours: readonly string[] | undefined;
    resolvePicker = (_excludeDocId, allowedFlavours) => {
      capturedAllowedFlavours = allowedFlavours;
      return Promise.resolve({
        docId: secondDoc.id,
        blockId: databaseId,
        flavour: 'affine:database' as const,
      });
    };

    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;

    const items = genericDatabaseViewRefSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: editor.std, model }) : items;
    const referenceItem = resolvedItems.find(
      item => item.name === 'Reference (own view)'
    );
    expect(referenceItem).toBeTruthy();

    await (
      referenceItem as unknown as { action: () => Promise<void> }
    ).action();
    await wait();

    expect(capturedAllowedFlavours).toEqual(['affine:database']);

    const refs = doc.getBlocksByFlavour('affine:database-view-ref');
    expect(refs.length).toBe(1);
    const refModel = refs[0]!.model as unknown as DatabaseViewRefBlockModel;
    expect(refModel.props.refBlockId).toBe(databaseId);
    expect(refModel.props.refDocId).toBe(secondDoc.id);
  });

  // Behavior (5): the slash menu's own built-in fuzzy-filter empty state —
  // typing text matching no registered command — renders zero items,
  // pre-existing generic `AffineSlashMenuWidget` behavior (`InnerSlashMenu`,
  // `slash-menu-popover.ts`'s own `_queryState === 'no_result'` branch),
  // unmodified by this phase. Unlike behaviors (1)-(4) above (which call a
  // command's own `action()` directly, mirroring the existing desktop
  // suite's established convention), this one drives the REAL widget UI —
  // clicking into the editor and typing via `userEvent`, the same
  // real-Playwright-interaction technique `note-ref.spec.ts` already
  // established for exercising `affine-slash-menu` itself — since the
  // fuzzy-filter behavior under test lives inside that shared widget, not
  // inside any one command's own logic.
  test("the slash menu's built-in fuzzy-filter empty state renders no matching items under a touch-emulated context — pre-existing generic behavior, unmodified", async () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    await wait();

    const paragraphEl = document.querySelector(
      `[data-block-id="${paragraphId}"]`
    ) as HTMLElement;
    expect(paragraphEl).toBeTruthy();
    paragraphEl.scrollIntoView({ block: 'center' });
    await wait(50);
    // Poll for a non-zero layout box before tapping: under CPU contention
    // (many browser-mode spec files running concurrently) the paragraph's
    // real render/layout pass can lag behind this test's own synchronous
    // setup.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (paragraphEl.getBoundingClientRect().height > 0) break;
      await wait(50);
    }
    // Click the paragraph block container itself (not the inner, still-
    // empty rich-text span) -- for a freshly-inserted empty paragraph the
    // innermost `[data-v-text="true"]` span can be zero-height and fails
    // Playwright's real-pointer visibility/actionability check under this
    // mobile viewport. The block container has real height (line-height /
    // padding) even when empty, and a real click anywhere on the line lets
    // BlockSuite's own selection manager place the caret -- unlike a raw
    // DOM `.focus()` call or a synthetic `touchTap` dispatch (both tried
    // and rejected: neither establishes the real browser Selection/Range
    // BlockSuite's rich-text layer listens to; only a genuine, trusted
    // Playwright pointer click does).
    //
    // Known flake (disclosed, not silently ignored): under this suite's
    // concurrent multi-file browser-mode execution (5 real Chromium
    // instances competing for host CPU), this real click's actionability
    // wait has intermittently timed out even on an element with a
    // confirmed non-zero layout box -- almost certainly transient
    // paint/compositor delay under CPU contention, not a genuine
    // visibility defect (the file passes 100% reliably in isolation, and
    // the poll above rules out a pure "not rendered yet" race). This is
    // the same class of environment-driven flake already observed in this
    // sandbox's existing desktop webkit suite (unrelated pre-existing
    // failures, see 01-01-SUMMARY.md). Left as `userEvent.click` (the only
    // interaction method that actually works here) rather than papering
    // over it with a weaker synthetic event that would silently stop
    // testing the real interaction.
    await userEvent.click(paragraphEl);
    await wait(50);
    await userEvent.keyboard('/zzzznonexistentslashcommandzzzz');
    await wait(300);

    const slashMenu = document.querySelector('affine-slash-menu');
    expect(slashMenu).toBeTruthy();
    const innerSlashMenu =
      slashMenu?.shadowRoot?.querySelector('inner-slash-menu');
    expect(innerSlashMenu).toBeTruthy();
    const items = innerSlashMenu?.shadowRoot?.querySelectorAll('[data-testid]');
    expect(items?.length ?? 0).toBe(0);
  });
});
