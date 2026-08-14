import { DatabaseBlockDataSource } from '@blocksuite/affine-block-database';
import { DatabaseBlockModel, DatabaseViewRefBlockModel } from '@blocksuite/affine-model';
import type { Filter, FilterGroup } from '@blocksuite/data-view';
import type {
  AfterImportBlockPayload,
  TransformerMiddleware,
} from '@blocksuite/store';
import { filter as rxFilter, map } from 'rxjs';

type ViewWithFilter = {
  id: string;
  name: string;
  mode: string;
  filter?: FilterGroup;
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
    return changed ? { node: { ...node, conditions }, changed: true } : { node, changed: false };
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
 * Registered into every `Transformer` used for duplication (see
 * `DocsService.duplicateFromTemplate`/`.duplicate()` in
 * `packages/frontend/core`), this runs once per freshly-created
 * `affine:database-view-ref` block **on the copy only** —
 * `slots.afterImport` fires per *target*-doc model, so the source
 * reference's own filter (e.g. yesterday's journal page, still showing
 * yesterday's own completed tasks) is never touched. The rewritten
 * literal matches what a fresh manual `/Journal Todo` insertion would
 * have produced if run at that same moment, which is exactly what a
 * duplicated reference should behave like.
 *
 * Best-effort: if the canonical database this reference points at can't
 * be resolved synchronously (e.g. it lives in a doc that isn't currently
 * loaded in this workspace), the literal is left as-is rather than
 * blocking or throwing — no worse than the pre-existing behavior for that
 * one edge case, and nothing else about the duplicate is affected.
 */
export const refreshJournalTodoGraceLiteralMiddleware =
  (): TransformerMiddleware =>
  ({ slots }) => {
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
          const targetStore =
            refDoc === model.store.doc
              ? model.store
              : refDoc.getStore({ id: refDoc.id });
          const canonicalModel = targetStore.getBlock(
            model.props.refBlockId
          )?.model;
          if (!(canonicalModel instanceof DatabaseBlockModel)) return;

          const doneDateColumnId = new DatabaseBlockDataSource(
            canonicalModel
          ).getDoneDateColumn()?.id;
          if (!doneDateColumnId) return;

          const nowMs = Date.now();
          const views = model.props.views as ViewWithFilter[];
          let anyChanged = false;
          const nextViews = views.map(view => {
            if (!view.filter) return view;
            const { node, changed } = rewriteDoneDateLiteral(
              view.filter,
              doneDateColumnId,
              nowMs
            );
            if (!changed) return view;
            anyChanged = true;
            return { ...view, filter: node as FilterGroup };
          });
          if (anyChanged) {
            model.props.views = nextViews;
          }
        } catch (error) {
          console.error(
            '[database-view-ref] failed to refresh Journal Todo grace-clause literal on duplicate',
            error
          );
        }
      });
    return () => subscription.unsubscribe();
  };
