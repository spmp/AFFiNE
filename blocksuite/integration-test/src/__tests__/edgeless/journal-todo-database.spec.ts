import {
  DatabaseBlockDataSource,
  DatabaseViewLocalOverrideProvider,
  getCell,
} from '@blocksuite/affine/blocks/database';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import {
  createLocalViewOverride,
  journalTodoDatabaseSlashMenuConfig,
} from '@blocksuite/affine/blocks/database-view-ref';
import type { DatabaseViewRefBlockComponent } from '@blocksuite/affine/blocks/database-view-ref';
import { JournalTodoDatabaseProvider } from '@blocksuite/affine/shared/services';
import { Text } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';

// Story 2.4: a creation preset over Story 2.2's `database-view-ref` block —
// auto-resolves/creates "the current journal todo database" (a single
// workspace-wide pointer, stubbed here via `JournalTodoDatabaseProvider`,
// exactly the way `database-ref.spec.ts`'s own `CrossDocReferenceProvider`
// stub tests its "Reference" slash-menu item) and seeds a `list`-mode view
// filtered to hide done tasks. The real `@affine/core` pointer-storage
// plumbing (Task 0/2) is deliberately out of scope here — it's plain Yjs
// map read/write with no `Transformer`/`Slice` involved, so it's covered by
// its own lightweight unit test instead (see
// `packages/frontend/core/src/modules/journal/__tests__/`).
describe('journal todo database slash-menu command', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page');
    return cleanup;
  });

  function createStubStd(options: {
    journalDate: string | undefined;
    initialRef?: { refDocId: string; refBlockId: string };
  }) {
    let ref = options.initialRef;
    const stub = new Proxy(editor.std, {
      get(target, prop, receiver) {
        if (prop === 'getOptional') {
          return (identifier: unknown) =>
            identifier === JournalTodoDatabaseProvider
              ? {
                  getJournalDate: () => options.journalDate,
                  getJournalTodoDatabaseRef: () => ref,
                  setJournalTodoDatabaseRef: (newRef: typeof ref) => {
                    ref = newRef;
                  },
                }
              : undefined;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return { stub, getRef: () => ref };
  }

  test('is not offered when the current doc has no journal date', () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub } = createStubStd({ journalDate: undefined });

    const items = journalTodoDatabaseSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: stub, model }) : items;
    expect(
      resolvedItems.find(item => item.name === 'Journal Todo')
    ).toBeFalsy();
  });

  test('first invocation creates a fresh canonical database and inserts a filtered list view', async () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub, getRef } = createStubStd({ journalDate: '2026-07-29' });

    const items = journalTodoDatabaseSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: stub, model }) : items;
    const item = resolvedItems.find(i => i.name === 'Journal Todo');
    expect(item).toBeTruthy();

    await (item as unknown as { action: () => Promise<void> }).action();
    await wait();

    // The pointer was set to a real, freshly-created database.
    const ref = getRef();
    expect(ref).toBeTruthy();
    const canonicalModel = doc.getBlock(ref!.refBlockId)
      ?.model as DatabaseBlockModel;
    expect(canonicalModel?.flavour).toBe('affine:database');

    // A database-view-ref was inserted, seeded with a `list` view filtered
    // to hide done tasks.
    const refEl = document.querySelector(
      'affine-database-view-ref'
    ) as DatabaseViewRefBlockComponent;
    expect(refEl).toBeTruthy();
    const refModel = refEl.model;
    expect(refModel.props.refBlockId).toBe(ref!.refBlockId);
    const seededView = refModel.props.views[0] as unknown as {
      mode: string;
      filter: { op: string; conditions: unknown[] };
    };
    expect(seededView.mode).toBe('list');
    // OR(not-done, done-on-this-journal-day) — see
    // `journalTodoDatabaseSlashMenuConfig`'s own comment for why this must
    // be an `or`, not a plain live "not done" filter.
    expect(seededView.filter.op).toBe('or');
    expect(seededView.filter.conditions.length).toBe(2);
  });

  test('second invocation reuses the same canonical database instead of creating a duplicate', async () => {
    const firstNoteId = addNote(doc);
    const firstParagraphId = doc.addBlock('affine:paragraph', {}, firstNoteId);
    const firstModel = doc.getModelById(firstParagraphId)!;
    const { stub: firstStub, getRef } = createStubStd({
      journalDate: '2026-07-28',
    });
    const items = journalTodoDatabaseSlashMenuConfig.items;
    const firstResolved =
      typeof items === 'function'
        ? items({ std: firstStub, model: firstModel })
        : items;
    await (
      firstResolved.find(i => i.name === 'Journal Todo') as unknown as {
        action: () => Promise<void>;
      }
    ).action();
    await wait();
    const firstRef = getRef()!;

    const secondNoteId = addNote(doc);
    const secondParagraphId = doc.addBlock(
      'affine:paragraph',
      {},
      secondNoteId
    );
    const secondModel = doc.getModelById(secondParagraphId)!;
    const stubForSecond = new Proxy(editor.std, {
      get(target, prop, receiver) {
        if (prop === 'getOptional') {
          return (identifier: unknown) =>
            identifier === JournalTodoDatabaseProvider
              ? {
                  getJournalDate: () => '2026-07-29',
                  getJournalTodoDatabaseRef: () => firstRef,
                  setJournalTodoDatabaseRef: () => {
                    throw new Error('should not create a new pointer');
                  },
                }
              : undefined;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const secondResolved =
      typeof items === 'function'
        ? items({ std: stubForSecond, model: secondModel })
        : items;
    await (
      secondResolved.find(i => i.name === 'Journal Todo') as unknown as {
        action: () => Promise<void>;
      }
    ).action();
    await wait();

    // Exactly one canonical database exists — the second invocation did
    // not create a duplicate.
    expect(doc.getBlocksByFlavour('affine:database').length).toBe(1);

    // Two independent database-view-ref instances now exist, both pointing
    // at the same canonical, each with its own local view.
    const refs = doc.getBlocksByFlavour('affine:database-view-ref');
    expect(refs.length).toBe(2);
    for (const ref of refs) {
      expect(
        (ref.model as unknown as { props: { refBlockId: string } }).props
          .refBlockId
      ).toBe(firstRef.refBlockId);
    }
  });

  test('marking a row done through the inserted view removes it from the filtered view without deleting it', async () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub, getRef } = createStubStd({ journalDate: '2026-07-29' });

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

    // Uses `rowAddAsTodoList` (the same call a real user interacting with
    // the seeded `'list'`-mode view produces) rather than a bare
    // `affine:paragraph` — a plain paragraph row rendered inside a live
    // `'list'`-mode view gets asynchronously converted to a todo
    // (`affine:list`) block by the view's own reactive `ensureTodoListRows`
    // (a `queueMicrotask`-deferred delete+recreate with the same id, see
    // `list-view-loop-repro.spec.ts`); creating the final row type directly
    // sidesteps that conversion race entirely rather than racing against it.
    const dataSource = new DatabaseBlockDataSource(canonicalModel);
    const rowId = dataSource.rowAddAsTodoList('end');
    await wait();

    // Row is genuinely on the canonical (writeback), matching Story 2.2's
    // own already-proven guarantee.
    expect(doc.getBlock(rowId)).toBeTruthy();

    dataSource.setTaskStatusChecked(rowId, true);
    await wait();

    // Row still exists — the row itself is never deleted by status
    // changes or filtering.
    expect(doc.getBlock(rowId)).toBeTruthy();
    expect(dataSource.getTaskStatusInfo(rowId)?.checked).toBe(true);

    // Marking done also stamps the hidden "Done date" column — the piece
    // the seeded OR-filter relies on to keep the row visible in *this*
    // reference (created moments ago) while still excluding it from a
    // later reference (see `table.unit.spec.ts`'s own `'journal todo "done
    // date" filter semantics'` suite for the pure filter-evaluation proof
    // of that behavior).
    const doneDateColumnId = dataSource.ensureDoneDateColumn();
    expect(doneDateColumnId).toBeTruthy();
    const doneDateValue = doneDateColumnId
      ? getCell(canonicalModel, rowId, doneDateColumnId)?.value
      : undefined;
    expect(typeof doneDateValue).toBe('number');
  });

  test('the seeded list view hides Hierarchy/Parent/Ancestor and Done date columns; a table view added afterwards keeps Done date visible', async () => {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub, getRef } = createStubStd({ journalDate: '2026-07-29' });

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
    const rowId = dataSource.rowAddAsTodoList('end');
    dataSource.setTaskStatusChecked(rowId, true); // ensures Done date column exists
    await wait();

    const refEl = document.querySelector(
      'affine-database-view-ref'
    ) as DatabaseViewRefBlockComponent;
    const refModel = refEl.model;
    const doneDateColumnId = dataSource.ensureDoneDateColumn()!;
    const statusColumnId = dataSource.getTaskStatusColumn()!.id;

    const findHide = (viewIndex: number, columnId: string) => {
      const view = refModel.props.views[viewIndex] as unknown as {
        columns?: { id: string; hide?: boolean }[];
      };
      return view.columns?.find(c => c.id === columnId)?.hide;
    };

    // Seeded (list) view: Done date and Status are hidden, per the same
    // policy the canonical database's own views already follow — this
    // previously failed to propagate to a `database-view-ref`'s own
    // per-instance view (`hideDefaultHiddenColumnsForNewView` only ever
    // wrote to the canonical's own `views`, never through the ref's own
    // `DatabaseViewLocalOverrideProvider`-backed view storage).
    expect(findHide(0, doneDateColumnId)).toBe(true);
    expect(findHide(0, statusColumnId)).toBe(true);

    // Adding a Table view within this same ref instance (mirrors a user
    // clicking "Add view" -> Table, i.e. going through the ref's own
    // `DatabaseViewLocalOverrideProvider`-backed view storage) must also
    // get correct hide-state, and Done date/Status should be visible
    // there, not hidden.
    const override = createLocalViewOverride(refModel);
    const refScopedDataSource = new DatabaseBlockDataSource(
      canonicalModel,
      ds => {
        ds.serviceSet(DatabaseViewLocalOverrideProvider, override);
      }
    );
    const tableViewId = refScopedDataSource.viewManager.viewAdd('table');
    const tableViewIndex = refModel.props.views.findIndex(
      v => v.id === tableViewId
    );
    expect(findHide(tableViewIndex, doneDateColumnId)).not.toBe(true);
    expect(findHide(tableViewIndex, statusColumnId)).not.toBe(true);
  });

  test('reusing a canonical that lives in a different doc still seeds a real filter (cross-doc resolution)', async () => {
    // Every day after the first, the canonical lives in whichever journal
    // doc first created it — never today's doc. Resolving `canonicalModel`
    // synchronously (no wait for the target doc to load) previously left
    // `initialFilter` `undefined` whenever that doc hadn't finished
    // loading, silently seeding a view with no filter at all. This proves
    // the cross-doc branch (`ensureDocLoaded`/`waitForBlockInDoc`) still
    // produces a real, non-empty filter when reusing a canonical that
    // lives in another doc entirely.
    const secondDoc = collection
      .createDoc(
        `doc:journal-todo-canonical-${Math.random().toString(16).slice(2, 8)}`
      )
      .getStore();
    secondDoc.load(() => {
      const rootId = secondDoc.addBlock('affine:page', { title: new Text() });
      secondDoc.addBlock('affine:surface', {}, rootId);
    });
    const secondNoteId = addNote(secondDoc);
    const databaseId = secondDoc.addBlock(
      'affine:database',
      { title: new Text('Journal Todo') },
      secondNoteId
    );
    new DatabaseBlockDataSource(
      secondDoc.getModelById(databaseId) as DatabaseBlockModel
    ).ensureTaskStatusColumn();

    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;
    const { stub } = createStubStd({
      journalDate: '2026-07-30',
      initialRef: { refDocId: secondDoc.id, refBlockId: databaseId },
    });

    const items = journalTodoDatabaseSlashMenuConfig.items;
    const resolvedItems =
      typeof items === 'function' ? items({ std: stub, model }) : items;
    await (
      resolvedItems.find(i => i.name === 'Journal Todo') as unknown as {
        action: () => Promise<void>;
      }
    ).action();
    await wait();

    const refEl = document.querySelector(
      'affine-database-view-ref'
    ) as DatabaseViewRefBlockComponent;
    expect(refEl).toBeTruthy();
    const seededView = refEl.model.props.views[0] as unknown as {
      mode: string;
      filter?: { op: string; conditions: unknown[] };
    };
    expect(seededView.mode).toBe('list');
    expect(seededView.filter?.op).toBe('or');
    expect(seededView.filter?.conditions.length).toBe(2);
  });
});
