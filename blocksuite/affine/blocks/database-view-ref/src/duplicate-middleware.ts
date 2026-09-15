import { DatabaseBlockDataSource } from '@blocksuite/affine-block-database';
import {
  DatabaseBlockModel,
  DatabaseViewRefBlockModel,
} from '@blocksuite/affine-model';
import { waitForBlockInDoc } from '@blocksuite/affine-shared/utils';
import type { Filter, FilterGroup } from '@blocksuite/data-view';
import type {
  AfterImportBlockPayload,
  TransformerMiddleware,
} from '@blocksuite/store';
import { filter as rxFilter, map } from 'rxjs';

type ViewColumn = { id: string; hide?: boolean } & Record<string, unknown>;
type ViewWithFilter = {
  id: string;
  name: string;
  mode: string;
  filter?: FilterGroup;
  columns?: ViewColumn[];
} & Record<string, unknown>;

function rewriteDoneDateLiteral(
  node: Filter,
  doneDateColumnId: string,
  nowMs: number
): { node: Filter; changed: boolean } {
  if (node.type === 'group') {
    let changed = false;
    const conditions = node.conditions.map(child => {
      const result = rewriteDoneDateLiteral(child, doneDateColumnId, nowMs);
      if (result.changed) changed = true;
      return result.node;
    });
    return changed
      ? { node: { ...node, conditions }, changed: true }
      : { node, changed: false };
  }
  if (
    node.function === 'after' &&
    node.left.type === 'ref' &&
    node.left.name === doneDateColumnId
  ) {
    return {
      node: { ...node, args: [{ type: 'literal', value: nowMs - 1 }] },
      changed: true,
    };
  }
  return { node, changed: false };
}

/**
 * Ensures `columnId` has a `hide: true` entry in this one view's own
 * `columns` array — the same effect `DatabaseBlockDataSource`'s private
 * `hidePropertyInOneView` produces, reimplemented directly against a
 * plain `view` snapshot rather than through a live `DataSource`/
 * `ViewManager`, since this runs during duplication against a freshly
 * -imported model that isn't wired into any rendered view yet.
 */
function hideColumnInView(
  view: ViewWithFilter,
  columnId: string
): { view: ViewWithFilter; changed: boolean } {
  const columns = view.columns ?? [];
  const idx = columns.findIndex(c => c.id === columnId);
  if (idx >= 0) {
    if (columns[idx]?.hide === true) {
      return { view, changed: false };
    }
    const nextColumns = [...columns];
    nextColumns[idx] = { ...nextColumns[idx], id: columnId, hide: true };
    return { view: { ...view, columns: nextColumns }, changed: true };
  }
  const entry: ViewColumn =
    view.mode === 'table'
      ? { id: columnId, width: 180, hide: true }
      : { id: columnId, hide: true };
  return { view: { ...view, columns: [...columns, entry] }, changed: true };
}

/**
 * Applies the actual grace-window-filter-rewrite + Note-color-column-hide
 * fix against a resolved canonical `DatabaseBlockModel`. Extracted so both
 * the synchronous fast path (canonical already resolvable) and the async
 * retry path (canonical's host doc had to be loaded first) share byte-
 * identical logic.
 */
function applyJournalTodoRefresh(
  model: DatabaseViewRefBlockModel,
  canonicalModel: DatabaseBlockModel
) {
  const dataSource = new DatabaseBlockDataSource(canonicalModel);
  const doneDateColumnId = dataSource.getDoneDateColumn()?.id;
  const noteColorColumnId = dataSource.getNoteColorColumn()?.id;
  if (!doneDateColumnId && !noteColorColumnId) return;

  const nowMs = Date.now();
  const views = model.props.views as ViewWithFilter[];
  let anyChanged = false;
  const nextViews = views.map(view => {
    let current = view;

    if (doneDateColumnId && current.filter) {
      const result = rewriteDoneDateLiteral(
        current.filter,
        doneDateColumnId,
        nowMs
      );
      if (result.changed) {
        current = { ...current, filter: result.node as FilterGroup };
        anyChanged = true;
      }
    }

    if (noteColorColumnId) {
      const result = hideColumnInView(current, noteColorColumnId);
      if (result.changed) {
        current = result.view;
        anyChanged = true;
      }
    }

    return current;
  });
  if (anyChanged) {
    model.props.views = nextViews;
  }
}

/**
 * Story 2.11 (live bug, resolved after two earlier attempts — see
 * `journalTodoDatabaseSlashMenuConfig`'s own comment in
 * `configs/slash-menu.ts` for the full history before changing this
 * again): the Journal Todo grace clause's "still show a row done after
 * this reference was created" cutoff is a literal `Date.now()`, frozen
 * the instant it's written, because the data-view filter engine has no
 * "relative to now" comparison. Left alone, every duplicate of an
 * `affine:database-view-ref` block — a journal template copied into a new
 * daily journal, or a plain "Duplicate doc" — would carry the *original*
 * reference's cutoff forever, so the copy would keep showing every task
 * done since the ORIGINAL was created, including ones done long before
 * the COPY itself came into being.
 *
 * Story 2.11 (follow-up live bug): the exact same "frozen at
 * template-edit-time" shape also affects per-view column *visibility* —
 * specifically the hidden "Note color" plumbing column
 * (`DatabaseBlockDataSource.ensureNoteColorColumn`'s own comment has the
 * full detail). That column only ever comes into existence lazily, the
 * first time any row anywhere gets a note attached — templates
 * realistically never have a note attached to one of their own rows, so
 * "Note color" essentially never exists yet when a template's own view
 * was last edited, and every daily duplicate inherits that same
 * hide-less view forever, since duplication copies `views` verbatim
 * rather than recomputing it. Handled here rather than in
 * `ensureNoteColorColumn` itself (which is *also* fixed, separately, to
 * self-correct for the reference that actually triggers a note-attach)
 * because a reference that never itself attaches a note would otherwise
 * never get a chance to hide a column that started existing elsewhere.
 *
 * Registered into every `Transformer` used for duplication (see
 * `DocsService.duplicateFromTemplate`/`.duplicate()` in
 * `packages/frontend/core`), this runs once per freshly-created
 * `affine:database-view-ref` block **on the copy only** —
 * `slots.afterImport` fires per *target*-doc model, so the source
 * reference's own state (e.g. yesterday's journal page) is never
 * touched. Every rewrite here matches what a fresh manual `/Journal
 * Todo` insertion would have produced if run at that same moment, which
 * is exactly what a duplicated reference should behave like.
 *
 * Story 2.11 (live bug report, second follow-up — "auto-selected-today"
 * bug): resolving the canonical is a genuinely cross-doc lookup on
 * *every* daily duplication — the canonical "essentially never" lives
 * inside the day's own journal page (see
 * `insertJournalTodoReference`'s own comment in `configs/slash-menu.ts`).
 * A first pass here only ever checked `workspace.getDoc(targetDocId)` ->
 * `.getStore()` -> `.getBlock()` *synchronously*, and silently skipped
 * both fixes above whenever that returned nothing — which is the
 * deterministic (not rare) outcome for a canonical whose host doc hasn't
 * been explicitly loaded yet this session (`DocImpl.getStore()` has no
 * readiness guard; it just reads whatever is currently in the doc's
 * Y.Map, empty until `.load()` is called and content streams in — see
 * `packages/frontend/core/src/modules/workspace/impls/doc.ts`). That hit
 * most often on the very first Journal-Todo-related action of a session
 * (typically: auto-select today, then "Create journal" from template,
 * before anything else has warmed the canonical's doc into memory) —
 * exactly the "auto-selected-today" bug report. Fixed by retrying via
 * `waitForBlockInDoc` (the same helper `insertJournalTodoReference`
 * already uses for the identical resolution problem) instead of giving
 * up permanently on the first synchronous miss — see
 * `refreshJournalTodoOnDuplicateMiddleware`'s own body below.
 */
export const refreshJournalTodoOnDuplicateMiddleware =
  (): TransformerMiddleware =>
  ({ slots }) => {
    let disposed = false;
    const subscription = slots.afterImport
      .pipe(
        rxFilter((p): p is AfterImportBlockPayload => p.type === 'block'),
        map(({ model }) => model),
        rxFilter(
          (model): model is DatabaseViewRefBlockModel =>
            model instanceof DatabaseViewRefBlockModel
        )
      )
      .subscribe(model => {
        try {
          const targetDocId = model.props.refDocId || model.store.id;
          const workspace = model.store.workspace;
          const refDoc = workspace.getDoc(targetDocId);
          if (!refDoc) return;
          const isSameDoc = refDoc === model.store.doc;
          const targetStore = isSameDoc
            ? model.store
            : refDoc.getStore({ id: refDoc.id });
          const canonicalModel = targetStore.getBlock(
            model.props.refBlockId
          )?.model;
          if (canonicalModel instanceof DatabaseBlockModel) {
            applyJournalTodoRefresh(model, canonicalModel);
            return;
          }

          // A same-doc reference's store is always the doc currently being
          // duplicated into — already guaranteed loaded, so a missing block
          // there means something else is wrong (e.g. a genuinely broken
          // ref), not a loading race. Only retry the genuinely cross-doc
          // case below.
          if (isSameDoc) return;

          // `workspace.getDoc()` returning a handle does NOT mean its
          // content has loaded yet: `refDoc.getStore()` (see `DocImpl` in
          // `packages/frontend/core/src/modules/workspace/impls/doc.ts`)
          // has no readiness guard and just reads whatever is currently in
          // the doc's Y.Map, which stays empty until `load()` is called and
          // nbstore streams its content in asynchronously. Per
          // `insertJournalTodoReference`'s own cross-doc branch in
          // `configs/slash-menu.ts` (identical resolution problem, already
          // solved there), the fix is to kick off loading and wait for the
          // block to actually appear rather than giving up permanently on
          // one synchronous check. This is the common case, not a rare
          // fluke: the canonical Journal Todo database "essentially never"
          // lives inside the day's own journal page (see that same file's
          // comment), so every daily duplication is a cross-doc resolution,
          // most likely to be hit cold on the first Journal-Todo-related
          // action of a session (e.g. auto-selecting today and creating
          // today's journal from template before anything else has warmed
          // this doc into memory).
          waitForBlockInDoc(refDoc, model.props.refBlockId)
            .then(found => {
              if (!found || disposed) return;
              const resolvedModel = targetStore.getBlock(
                model.props.refBlockId
              )?.model;
              if (resolvedModel instanceof DatabaseBlockModel) {
                applyJournalTodoRefresh(model, resolvedModel);
              }
            })
            .catch(error => {
              console.error(
                '[database-view-ref] failed to load canonical to refresh Journal Todo state on duplicate',
                error
              );
            });
        } catch (error) {
          console.error(
            '[database-view-ref] failed to refresh Journal Todo state on duplicate',
            error
          );
        }
      });
    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  };
