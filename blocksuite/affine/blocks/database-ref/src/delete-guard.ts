import { NoteDisplayMode } from '@blocksuite/affine-model';
import type {
  DatabaseRefBlockModel,
  NoteBlockModel,
} from '@blocksuite/affine-model';
import { Store } from '@blocksuite/store';

import { forgetLastActiveRef } from './database-ref-block';

let installed = false;

/**
 * Deleting a `database-ref` block (via its own selection toolbar, Backspace
 * on a `BlockSelection`, cut, a text-range delete that swept over it,
 * undo/redo, ...) should — mirroring Frame's `surface-ref` — only ever
 * remove *that one view*. But unlike a `surface-ref`, whose underlying
 * frame keeps living untouched forever regardless of how many references
 * to it exist or get deleted, a promoted database has no independent home
 * of its own once its last reference is gone: it sits in a hidden note
 * purely so it has *somewhere* to live (see `commands.ts`'s
 * `ensurePromoted`), not because that's meaningful storage on its own.
 * So deleting the very last reference needs to finish the job — deleting
 * the canonical table (and its rows, and the now-empty hidden note) too —
 * rather than leaving it stranded forever, invisible and unreachable by
 * any UI, but still silently present in the document.
 *
 * A `database-ref`'s own identity unambiguously names "this one view"
 * regardless of what triggered its deletion, so a single global hook on
 * `Store.prototype.deleteBlock`, scoped to just this flavour, is safe —
 * unlike deleting the *canonical* database directly (e.g. via its own
 * "Delete Database" more-menu action, reachable because this package
 * renders the real, fully-interactive `affine-database` component rather
 * than a read-only snapshot), which has no such unambiguous identity from
 * inside a generic `deleteBlock` call and is instead redirected at the
 * source, per-instance, in `database-ref-block.ts`.
 */
export function installDatabaseRefCascadeDelete() {
  if (installed) return;
  installed = true;

  const original = Store.prototype.deleteBlock;

  Store.prototype.deleteBlock = function (this: Store, model, options): void {
    const targetModel =
      typeof model === 'string' ? this.getBlock(model)?.model : model;

    if (!targetModel || targetModel.flavour !== 'affine:database-ref') {
      original.call(this, model, options);
      return;
    }

    const refBlockId = (targetModel as DatabaseRefBlockModel).props.refBlockId;
    // Deletions can be issued through a filtered/queried preview store that
    // can't see references living elsewhere in the doc — resolve siblings
    // through the full, unfiltered store instead. `{ id: this.doc.id }`
    // reuses that doc's one default store rather than minting a fresh one
    // (a plain `getStore()` always generates a new cache key) — this runs on
    // every deletion of any `database-ref`, so an unnecessary new `Store`
    // per call adds up exactly like the churn `database-ref-block.ts` had
    // to fix in its own polling path.
    const fullStore = this.doc.getStore({ id: this.doc.id });
    const hasOtherRefs = fullStore
      .getBlocksByFlavour('affine:database-ref')
      .some(
        b =>
          b.model.id !== targetModel.id &&
          (b.model as DatabaseRefBlockModel).props.refBlockId === refBlockId
      );

    original.call(this, model, options);

    if (hasOtherRefs) return;

    const canonical = fullStore.getBlock(refBlockId)?.model;
    if (!canonical) return;

    const hiddenNote = fullStore.getParent(canonical);
    original.call(fullStore, canonical, undefined);
    forgetLastActiveRef(refBlockId);

    if (
      hiddenNote &&
      hiddenNote.flavour === 'affine:note' &&
      (hiddenNote as NoteBlockModel).props.displayMode ===
        NoteDisplayMode.EdgelessOnly &&
      fullStore.getBlock(hiddenNote.id) &&
      hiddenNote.children.length === 0
    ) {
      original.call(fullStore, hiddenNote, undefined);
    }
  };
}
