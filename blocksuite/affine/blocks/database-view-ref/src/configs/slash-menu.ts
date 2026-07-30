import { toast } from '@blocksuite/affine-components/toast';
import { DatabaseBlockDataSource } from '@blocksuite/affine-block-database';
import { DatabaseBlockSchema, NoteDisplayMode } from '@blocksuite/affine-model';
import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import {
  CrossDocReferenceProvider,
  JournalTodoDatabaseProvider,
} from '@blocksuite/affine-shared/services';
import {
  ensureDocLoaded,
  waitForBlockInDoc,
} from '@blocksuite/affine-shared/utils';
import type { FilterGroup } from '@blocksuite/data-view';
import {
  type SlashMenuActionItem,
  type SlashMenuConfig,
  type SlashMenuItem,
  SlashMenuConfigExtension,
} from '@blocksuite/affine-widget-slash-menu';
import {
  DatabaseListViewIcon,
  DatabaseTableViewIcon,
  LinkIcon,
} from '@blocksuite/icons/lit';
import { BlockSelection } from '@blocksuite/std';
import { Text } from '@blocksuite/store';

import { insertDatabaseViewRefBlockCommand } from '../commands.js';

/**
 * Story 2.4: a creation preset over `insertDatabaseViewRefBlockCommand`
 * (Story 2.2) — auto-resolves (or creates, on first-ever use) "the current
 * journal todo database" (a single workspace-wide pointer, see
 * `JournalTodoDatabaseProvider`) and inserts a reference to it seeded with
 * a `'list'`-mode view filtered to hide done tasks. Only offered inside a
 * journal doc (gated on `getJournalDate` resolving) — general-purpose
 * "reference an arbitrary database" is Story 2.5's job, not this one.
 */
export const journalTodoDatabaseSlashMenuConfig: SlashMenuConfig = {
  items: ({ std, model }) => {
    const journalTodo = std.getOptional(JournalTodoDatabaseProvider);
    if (!journalTodo) return [];

    const journalDate = journalTodo.getJournalDate(std.store.id);
    if (!journalDate) return [];

    return [
      {
        name: 'Journal Todo',
        description: 'Insert your journal task list',
        searchAlias: ['todo', 'journal', 'tasks'],
        icon: DatabaseListViewIcon(),
        group: '7_Database@2',
        action: async () => {
          const store = std.store;

          let ref = journalTodo.getJournalTodoDatabaseRef();
          let justCreatedCanonical:
            | { hiddenNoteId: string; databaseId: string }
            | undefined;
          if (!ref) {
            // First-ever use: create a fresh canonical database, pre-
            // promoted into its own hidden note (mirrors
            // `database-ref/src/commands.ts`'s `moveIntoHiddenNote` shape,
            // constructed directly here since there's nothing to promote
            // yet — this *is* the first reference).
            store.captureSync();
            const hiddenNoteId = store.addBlock(
              'affine:note',
              {
                displayMode: NoteDisplayMode.EdgelessOnly,
                xywh: '[-10000, -10000, 800, 480]',
              },
              store.root!.id
            );
            const databaseId = store.addBlock(
              'affine:database',
              { title: new Text('Journal Todo') },
              hiddenNoteId
            );
            const databaseModel = store.getBlock(databaseId)
              ?.model as DatabaseBlockModel;
            new DatabaseBlockDataSource(databaseModel).ensureTaskStatusColumn();

            ref = { refDocId: store.id, refBlockId: databaseId };
            justCreatedCanonical = { hiddenNoteId, databaseId };
            journalTodo.setJournalTodoDatabaseRef(ref);
          }

          // Resolve the Status column/"done" option off whichever
          // canonical we're pointing at (freshly created or previously
          // established) to build the "not done" filter — reuses the same
          // accessors `ensureTaskStatusColumn`/task-status resolution
          // already use elsewhere, rather than a second Status-finding
          // mechanism.
          //
          // Cross-doc reuse (every day after the first, since the canonical
          // lives wherever it was first created, essentially never today's
          // doc): the target doc may not be loaded locally yet, so this
          // must wait for it the same way `insertDatabaseViewRefBlockCommand`'s
          // own cross-doc branch does — resolving `canonicalModel`
          // synchronously here would silently skip filter construction
          // whenever the doc hadn't finished loading, seeding a view with
          // no filter at all (showing every task, done or not).
          const isCrossDoc = ref.refDocId !== store.id;
          let canonicalStore = isCrossDoc ? undefined : store;
          if (isCrossDoc) {
            const refDoc = std.workspace.getDoc(ref.refDocId);
            if (refDoc) {
              ensureDocLoaded(refDoc);
              const found = await waitForBlockInDoc(refDoc, ref.refBlockId);
              canonicalStore = found
                ? refDoc.getStore({ id: refDoc.id })
                : undefined;
            }
          }
          const canonicalModel = canonicalStore?.getBlock(ref.refBlockId)
            ?.model as DatabaseBlockModel | undefined;

          let initialFilter: FilterGroup | undefined;
          if (canonicalModel) {
            const dataSource = new DatabaseBlockDataSource(canonicalModel);
            const statusColumnId = dataSource.ensureTaskStatusColumn();
            const doneOption = dataSource.getTaskStatusTargetOption(
              'done',
              statusColumnId
            );
            if (statusColumnId && doneOption) {
              const doneDateColumnId = dataSource.ensureDoneDateColumn();
              // A task done *after this specific reference was inserted*
              // stays visible in this reference — it's only excluded once
              // a later reference (a fresh `database-view-ref`, inserted
              // later in real wall-clock time) is created. Deliberately
              // NOT based on the journal's own date: a journal can be
              // dated in the future or the past, but "was this marked
              // done since I opened this particular list" is always a
              // real-time question, regardless of which day the journal
              // page itself represents — otherwise checking a box in a
              // future- or past-dated journal would immediately hide the
              // row instead of just marking it done. Live re-evaluation of
              // a plain "not done" filter would otherwise hide a row the
              // instant it's marked done, even from the very same
              // reference it was just checked off in.
              const referenceCreatedAtMs = Date.now();
              initialFilter = {
                type: 'group',
                op: 'or',
                conditions: [
                  {
                    type: 'filter',
                    left: { type: 'ref', name: statusColumnId },
                    function: 'isNotOneOf',
                    args: [{ type: 'literal', value: [doneOption.id] }],
                  },
                  ...(doneDateColumnId
                    ? [
                        {
                          type: 'filter' as const,
                          left: {
                            type: 'ref' as const,
                            name: doneDateColumnId,
                          },
                          function: 'after',
                          args: [
                            {
                              type: 'literal' as const,
                              value: referenceCreatedAtMs - 1,
                            },
                          ],
                        },
                      ]
                    : []),
                ],
              };
            }
          }

          const [_, result] = std.command.exec(
            insertDatabaseViewRefBlockCommand,
            {
              refBlockId: ref.refBlockId,
              refDocId: ref.refDocId,
              place: 'after',
              removeEmptyLine: true,
              selectedModels: [model],
              initialView: { viewType: 'list', initialFilter },
            }
          );
          if (!result.insertedDatabaseViewRefBlockId) {
            // If this invocation just created the canonical (first-ever
            // use) and insertion still failed, roll it back rather than
            // leaving an orphaned database + a permanent workspace pointer
            // with no visible reference anywhere — every future invocation
            // would otherwise silently reuse this empty, ref-less canonical.
            if (justCreatedCanonical) {
              store.deleteBlock(justCreatedCanonical.databaseId);
              store.deleteBlock(justCreatedCanonical.hiddenNoteId);
              journalTodo.setJournalTodoDatabaseRef(undefined);
            }
            toast(std.host, 'Could not insert the journal todo list.');
            return;
          }
          std.selection.set([
            std.selection.create(BlockSelection, {
              blockId: result.insertedDatabaseViewRefBlockId,
            }),
          ]);
        },
      },
    ];
  },
};

export const JournalTodoDatabaseSlashMenuConfigExtension =
  SlashMenuConfigExtension(
    'affine:database-view-ref-journal-todo',
    journalTodoDatabaseSlashMenuConfig
  );

/**
 * Story 2.5: the generic, non-journal-specific counterpart to
 * `journalTodoDatabaseSlashMenuConfig` above — lets a user reference *any*
 * database (same-doc or cross-doc) and get a `database-view-ref` with its
 * own independent, unfiltered `'table'` view (no auto-resolution, no
 * auto-filter). Purely additive alongside `database-ref/src/configs/
 * slash-menu.ts`'s existing "Table: <name>"/"Reference" items, which keep
 * producing plain `database-ref` (shared views) exactly as before — this
 * is a second, distinctly-labeled choice for when an independent view is
 * wanted, not a replacement.
 */
export const genericDatabaseViewRefSlashMenuConfig: SlashMenuConfig = {
  items: ({ std, model }) => {
    // Starts well past `journalTodoDatabaseSlashMenuConfig`'s own hardcoded
    // `'7_Database@2'` slot (same file, same `'Database'` group) to avoid a
    // sort-key collision — both configs are registered together in
    // `view.ts`, and a same-doc-item count of 3+ would otherwise land on
    // the exact same key as the "Journal Todo" item, producing an
    // unintended, arbitrary relative order between two unrelated entries.
    let index = 100;

    // `model` is the slash command's own anchor block (e.g. a paragraph) —
    // never a database itself, so there is no "self" to exclude here;
    // every same-doc database block is a valid candidate.
    const databaseBlocks = std.store.getBlocksByFlavour(
      DatabaseBlockSchema.model.flavour
    );

    const sameDocItems = databaseBlocks.map<SlashMenuActionItem>(block => {
      const databaseModel = block.model as DatabaseBlockModel;
      const title = databaseModel.props.title.toString();
      return {
        name: 'Table (own view): ' + (title || '(untitled)'),
        description: 'Reference this table with an independent view/filter',
        icon: DatabaseTableViewIcon(),
        group: `7_Database@${index++}`,
        action: () => {
          const [_, result] = std.command.exec(
            insertDatabaseViewRefBlockCommand,
            {
              refBlockId: block.id,
              place: 'after',
              removeEmptyLine: true,
              selectedModels: [model],
            }
          );
          if (!result.insertedDatabaseViewRefBlockId) return;
          std.selection.set([
            std.selection.create(BlockSelection, {
              blockId: result.insertedDatabaseViewRefBlockId,
            }),
          ]);
        },
      };
    });

    // Same picker `database-ref`'s own "Reference" item uses, restricted to
    // `affine:database` candidates only — frames/notes have no
    // `database-view-ref` counterpart to insert.
    const crossDocItem: SlashMenuItem = {
      name: 'Reference (own view)',
      description:
        'Reference a table from a different doc with an independent view/filter',
      icon: LinkIcon(),
      group: `7_Database@${index++}`,
      action: async () => {
        const crossDocReference = std.getOptional(CrossDocReferenceProvider);
        if (!crossDocReference) {
          toast(std.host, 'Cross-doc referencing is not available.');
          return;
        }

        const candidate = await crossDocReference.openCrossDocReferencePicker(
          std.store.id,
          ['affine:database']
        );
        // A `null` candidate means the user cancelled the picker — not a
        // failure, so no toast here.
        if (!candidate) return;
        // Defensive: don't trust that passing `['affine:database']` as
        // `allowedFlavours` guarantees the picker only ever returns that
        // flavour — a misconfigured/future provider implementation could
        // still return something else, which must not be silently
        // inserted as if it were a database.
        if (candidate.flavour !== 'affine:database') {
          toast(std.host, 'Could not insert that reference.');
          return;
        }

        const [_, result] = std.command.exec(
          insertDatabaseViewRefBlockCommand,
          {
            refBlockId: candidate.blockId,
            refDocId: candidate.docId,
            place: 'after',
            removeEmptyLine: true,
            selectedModels: [model],
          }
        );
        if (!result.insertedDatabaseViewRefBlockId) {
          toast(std.host, 'Could not insert that reference.');
          return;
        }

        std.selection.set([
          std.selection.create(BlockSelection, {
            blockId: result.insertedDatabaseViewRefBlockId,
          }),
        ]);
      },
    };

    return [...sameDocItems, crossDocItem];
  },
};

export const GenericDatabaseViewRefSlashMenuConfigExtension =
  SlashMenuConfigExtension(
    'affine:database-view-ref-generic',
    genericDatabaseViewRefSlashMenuConfig
  );
