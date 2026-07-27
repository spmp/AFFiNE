import type { NoteRefBlockModel } from '@blocksuite/affine-model';
import { ViewExtensionManagerIdentifier } from '@blocksuite/affine-ext-loader';
import { ensureDocLoaded } from '@blocksuite/affine-shared/utils';
import { BlockComponent, BlockStdScope, TextSelection } from '@blocksuite/std';
import { RANGE_QUERY_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import type { BlockModel, Query, Store } from '@blocksuite/store';
import { css, html, nothing } from 'lit';
import { guard } from 'lit/directives/guard.js';

import { NoteRefPreviewRootOverride } from './preview-root';

/**
 * Every reference to the same cross-doc canonical Note shares one
 * `refDoc.getStore({query})` instance (the query only depends on the
 * canonical's own ancestor chain, not on which reference asked for it —
 * same caching behavior `database-ref` documents for its own preview
 * store). Ref-counted so the store (and its entire independent reactive
 * object graph — see `database-ref-block.ts`'s own module comment on this
 * exact hazard) is only disposed once nothing renders through it anymore,
 * mirroring that file's `previewStoreRefCounts`/`retain`/`releasePreviewStore`
 * exactly (duplicated locally rather than imported — these are
 * `database-ref`-package-private, and Note doesn't share its canonical's
 * exact query shape).
 */
const previewStoreRefCounts = new Map<Store, number>();

function retainPreviewStore(store: Store) {
  previewStoreRefCounts.set(store, (previewStoreRefCounts.get(store) ?? 0) + 1);
}

function releasePreviewStore(
  store: Store | null,
  refDoc: Store['doc'] | null,
  query: Query | null
) {
  if (!store) return;
  const count = (previewStoreRefCounts.get(store) ?? 1) - 1;
  if (count > 0) {
    previewStoreRefCounts.set(store, count);
    return;
  }
  previewStoreRefCounts.delete(store);
  store.dispose();
  if (refDoc && query) {
    try {
      refDoc.removeStore({ query });
    } catch {
      // The doc may already be disposed (e.g. workspace switched away
      // entirely) by the time this cleanup runs — nothing left to evict.
    }
  }
}

/**
 * Renders a live view of a single `affine:note` block, addressed by
 * `refBlockId` + `refDocId`.
 *
 * Two entirely different rendering mechanisms, chosen by `_isCrossDoc()`:
 *
 * SAME-DOC (`refDocId` unset or equal to the current doc, Story 0.6):
 * the *thinnest possible* mechanism — `BlockComponent` (the base class
 * every block, including `affine-note`'s own, extends) picks up `std`/
 * `store` via Lit's `@consume({context})`, resolved from whichever
 * `EditorHost` is its nearest DOM ancestor, not from however it got added
 * to that DOM. So rendering the canonical note's children here, through
 * `this.std.host.renderChildren(canonical)`, uses the exact same std,
 * store, dispatcher, selection/range manager, and keymaps as any other
 * block on the page — no nested `BlockStdScope`, no second `Store`, no
 * synchronization to ever get out of sync, because there is only ever one
 * of each.
 *
 * CROSS-DOC (`refDocId` genuinely different, Story 0.5): the same-doc
 * mechanism above cannot work here — `BlockComponent.model`/`.store`
 * (the base every rendered block relies on, all the way down) resolve via
 * the *ambient* `std.store`, the one shared store for the *current* doc.
 * A cross-doc canonical's children simply don't exist in that store at
 * all, so every child would silently fail to resolve its own model the
 * moment it mounts (confirmed live: `Cannot find block model for id N`,
 * thrown from deep inside `paragraph-block.ts`'s own `connectedCallback`,
 * for every single child). This mounts a genuinely separate nested
 * `BlockStdScope` bound to a `Query`-filtered `Store` for the *foreign*
 * doc instead — exactly `database-ref`'s own proven cross-doc mechanism
 * (`database-ref-block.ts`), adapted for Note. This reintroduces a second,
 * independent dispatcher/selection/view-registry — the same tradeoff
 * `database-ref`/`surface-ref` already carry for their own cross-doc
 * cases — which is why the same-doc path above deliberately avoids it
 * whenever it doesn't have to.
 */
export class NoteRefBlockComponent extends BlockComponent<NoteRefBlockModel> {
  static override styles = css`
    affine-note-ref {
      display: block;
    }
    affine-note-ref[data-show-border='true'] {
      border: 1px solid var(--affine-border-color);
      border-radius: 4px;
      padding: 4px 8px;
    }
  `;

  private _targetDocUnsubscribe: (() => void) | null = null;

  private _refreshDebounce: ReturnType<typeof setTimeout> | null = null;

  private _rangeExcludeObserver: MutationObserver | null = null;

  // Cross-doc-only state (nested `BlockStdScope` path).
  private _previewStore: Store | null = null;

  private _previewRefDoc: Store['doc'] | null = null;

  private _previewQuery: Query | null = null;

  private _resolveError: string | null = null;

  private _ancestorChain: string[] = [];

  /**
   * Render-time backstop against unbounded recursive nesting: reference
   * creation (`insertNoteRefBlockCommand`, `cycle.ts`) already rejects any
   * reference that would form a cycle, but that's not a hard guarantee for
   * every possible way a `note-ref` could end up pointing where it does
   * (e.g. data from before this check existed, or a chain of references
   * deep enough to be merely slow rather than truly cyclic). Since this
   * component's rendered content is always a literal DOM descendant of
   * itself (`renderBlock`'s nested `BlockStdScope.render()` mounts into
   * this element's own light DOM), any ancestor `<affine-note-ref>` already
   * resolving to the exact same target means rendering it again here would
   * recurse: that nested copy would itself try to render the same target,
   * which contains this same reference, forever. Checked once per
   * `connectedCallback`/target-change rather than continuously — a cycle
   * that exists is structural, not something that starts or stops existing
   * between renders.
   */
  private _wouldRenderCycle(targetDocId: string, targetBlockId: string) {
    let ancestor = this.parentElement;
    while (ancestor) {
      if (ancestor.tagName.toLowerCase() === 'affine-note-ref') {
        const ancestorComponent = ancestor as NoteRefBlockComponent;
        const ancestorDocId =
          ancestorComponent.model.props.refDocId ||
          ancestorComponent.std.store.id;
        const ancestorBlockId = ancestorComponent.model.props.refBlockId;
        if (
          ancestorDocId === targetDocId &&
          ancestorBlockId === targetBlockId
        ) {
          return true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  private get _previewSpec() {
    return [
      ...this.std.get(ViewExtensionManagerIdentifier).get('preview-page'),
      NoteRefPreviewRootOverride,
    ];
  }

  private get _targetDocId(): string {
    return this.model.props.refDocId || this.std.store.id;
  }

  private get _isCrossDoc(): boolean {
    return (
      !!this.model.props.refDocId &&
      this.model.props.refDocId !== this.std.store.id
    );
  }

  private _getCanonical(): BlockModel | null {
    const refDoc = this.std.workspace.getDoc(this._targetDocId);
    if (!refDoc) return null;
    ensureDocLoaded(refDoc);

    // Same-doc case: `this.std.store` is already the correct, single
    // shared store for the current doc — reuse it directly rather than
    // fetching a second `Store` instance for the doc we're already in.
    // Cross-doc case: `refDoc` is a genuinely different doc, so its own
    // (unfiltered — this is for structural reads/writes like
    // `_ensureTrailingParagraph`, not for rendering) `Store` has to be
    // fetched explicitly.
    const targetStore =
      refDoc === this.std.store.doc
        ? this.std.store
        : refDoc.getStore({ id: refDoc.id });

    const canonical = targetStore.getBlock(this.model.props.refBlockId)?.model;
    if (!canonical || canonical.flavour !== 'affine:note') return null;
    return canonical;
  }

  // ---------------------------------------------------------------------
  // Same-doc path (Story 0.6) — unchanged from before Story 0.5.
  // ---------------------------------------------------------------------

  /**
   * The canonical note's real children render as ordinary light-DOM
   * `[data-block-id]` elements, indistinguishable from first-class page
   * content to a naive DOM walk — so a text-range selection sweeping
   * across this reference could otherwise resolve the real canonical
   * note's children as "in range" and delete them directly (the same
   * hazard `database-ref` and `surface-ref` both guard against for their
   * own nested previews, for the identical structural reason).
   *
   * Unlike those two, though, this reference's content is ordinary rich
   * text that the user actually edits in place — and `RangeManager`'s
   * `[data-block-id]:not([data-range-query-exclude])` selector (see
   * `getSelectedBlockComponentsByRange`) is also what commands like
   * `getSelectedModelsCommand` use to resolve "the block(s) the cursor is
   * currently in" (e.g. for slash-menu actions that insert a sibling
   * block). A *permanent* blanket exclusion — which is what `database-ref`
   * and `surface-ref` both use, safely, since neither one's nested content
   * is ever a `getSelectedModelsCommand` target — silently makes every
   * such command see zero selected models while the cursor is anywhere
   * inside this reference, breaking things like "insert a database here"
   * without any visible error.
   *
   * So instead this only excludes the subtree while the current selection
   * is *not* fully contained within it — i.e. while some other, external
   * range could be sweeping across this reference's boundary. While the
   * user's cursor/selection lives entirely inside (the normal editing
   * case), the exclusion is lifted so ordinary block-resolution commands
   * work exactly as they would for non-referenced content.
   *
   * Only used for the same-doc path — the cross-doc path's nested scope
   * has its own entirely separate selection system, so this reactive
   * approach doesn't apply there (see `_observeForCrossDocRangeExclusion`).
   */
  private _updateRangeQueryExclusion = () => {
    const descendants = Array.from(
      this.querySelectorAll<HTMLElement>('[data-block-id]')
    );
    if (descendants.length === 0) return;

    const selections = this.std.selection.value;
    const referencedBlockIds = new Set<string>();
    for (const sel of selections) {
      referencedBlockIds.add(sel.blockId);
      if (sel.is(TextSelection) && sel.to) {
        referencedBlockIds.add(sel.to.blockId);
      }
    }

    const descendantIds = new Set(
      descendants.map(el => el.getAttribute('data-block-id'))
    );
    const allInside =
      referencedBlockIds.size > 0 &&
      Array.from(referencedBlockIds).every(id => descendantIds.has(id));

    descendants.forEach(el => {
      if (allInside) {
        el.removeAttribute(RANGE_QUERY_EXCLUDE_ATTR);
      } else {
        el.setAttribute(RANGE_QUERY_EXCLUDE_ATTR, 'true');
      }
    });
  };

  private _observeForRangeQueryExclusion() {
    this._rangeExcludeObserver?.disconnect();
    this._updateRangeQueryExclusion();
    this._rangeExcludeObserver = new MutationObserver(() => {
      this._updateRangeQueryExclusion();
    });
    this._rangeExcludeObserver.observe(this, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * When the *same* canonical note is referenced by more than one `note-ref`
   * simultaneously visible on a page, its content genuinely renders in more
   * than one place at once — each occurrence is a distinct `BlockComponent`
   * instance, but all of them share the same underlying block id (since
   * they're the same Yjs blocks, addressed identically). `ViewStore`
   * (`this.std.view`), though, is a single global `id -> BlockComponent` map
   * with no concept of "which occurrence" — `setBlock` just has the latest
   * registrant win, unconditionally (see `ViewStore.setBlock`). Any command
   * that resolves "the component for this block id" through it (e.g. the
   * slash-menu widget's `getInlineEditorByModel`/`host.view.getBlock` calls)
   * then silently operates on whichever occurrence happened to mount last,
   * not necessarily the one the user is actually typing in — which reads as
   * the slash menu (and similar id-based commands) mysteriously not working
   * in one of the two copies.
   *
   * Only relevant for the same-doc path — the cross-doc path's nested
   * scope has its own entirely separate `ViewStore`, so there's no shared
   * registry to fight over there.
   *
   * A real per-instance registry would need a broader `ViewStore` change
   * (out of scope for a single reference type). Instead, this reclaims
   * registration for every block rendered by *this* `note-ref` occurrence
   * the moment the user starts interacting with it — each embedded block
   * element already *is* its own `BlockComponent` instance (the custom
   * element and the component are the same object), so re-registering is
   * just calling `setBlock` again on it. This doesn't fix the ambiguity in
   * general (switching focus between the two copies without a fresh
   * pointerdown/focusin could still race), but it does fix the overwhelmingly
   * common case: the copy you just clicked/tapped into becomes "the"
   * registered one for as long as you keep working in it.
   */
  private _reclaimViewRegistration = () => {
    this.querySelectorAll<BlockComponent>('[data-block-id]').forEach(el => {
      this.std.view.setBlock(el);
    });
  };

  /**
   * A note rendered top-level on the page always has a landing spot after
   * its last block, however that block ends — even a non-text one (LaTeX,
   * Image, a nested note reference, Database) — because
   * `PageRootBlockComponent`'s blank-area click handler
   * (`page-root-block.ts`) checks whether the page's own last note ends in
   * an empty paragraph and, if not, calls `appendParagraphCommand`. That
   * check is hardcoded to `getLastNoteBlock(store)` (the page's *own* last
   * note) — it has no way to reach a canonical note embedded mid-page
   * inside a `note-ref`, and there's no equivalent blank area to click
   * inside a reference's own tightly-fitted rendering anyway. Without an
   * equivalent guarantee here, a non-text block landing last in a
   * referenced note (which is entirely possible — e.g. `/equation`, a
   * nested `/note`, or any future `/image`) leaves the user with
   * *nothing* to click or type into afterward within that note at all.
   *
   * Rather than duplicate the page-root's click-area/hit-testing approach
   * (which depends on there being physical blank canvas space below
   * content — not something this reference's own compact rendering has),
   * this guarantees the invariant proactively: whenever the canonical's
   * last child isn't already an empty paragraph, one is appended. This
   * mirrors the same "always end on an empty paragraph" invariant a
   * freshly created canonical note already starts with, just re-checked
   * after every change instead of only at creation. Since the canonical is
   * an `EdgelessOnly` note the user never otherwise views directly on the
   * edgeless canvas (unlike the earlier, reverted attempt to do this for
   * ordinary edgeless-visible notes — see this story's Change Log for
   * 2026-07-22 — which visibly grew content the user was actively
   * watching in edgeless), there's no equivalent surprise here.
   *
   * Applies to both the same-doc and cross-doc paths (uses `_getCanonical`,
   * which already resolves either case, and `canonical.store` — the
   * canonical's own originating store — rather than `this.std.store`).
   */
  private _ensureTrailingParagraph() {
    const canonical = this._getCanonical();
    if (!canonical) return;

    const lastChild = canonical.children[canonical.children.length - 1];
    // Any block with its own text (paragraph, list, heading-like blocks —
    // checked structurally via `.text`, not by flavour, since anything
    // text-capable already gives a place to click/type/press Enter) is
    // already a fine place to continue — only a block with *no* text at
    // all (LaTeX, Image, Database, a nested note-ref, ...) needs a
    // trailing paragraph added after it. Deliberately not narrowed to
    // "ends in an *empty* paragraph" — a non-empty last paragraph (e.g. a
    // freshly created reusable note's own labeled first line) is already
    // just as good a landing spot, and treating it as "needs one more"
    // caused a real regression: two references sharing the same canonical
    // both independently topping up "one more empty paragraph" after any
    // render, snowballing extra blank lines neither reference asked for.
    if (lastChild?.text !== undefined) return;

    // Uses `canonical.store` (the canonical's *own* originating store), not
    // `this.std.store` (this component's own, possibly-foreign-doc host
    // store) — for a cross-doc reference those are two different stores
    // entirely, and mutating the wrong one would either silently no-op or
    // corrupt the referencing doc instead of the canonical's real host doc.
    canonical.store.captureSync();
    canonical.store.addBlock('affine:paragraph', {}, canonical.id);
  }

  /**
   * There's no dedicated "a different note's children changed" signal to
   * subscribe to directly, so this falls back to the doc's raw Yjs
   * `update` event (fires on any change in the doc, not just this
   * canonical) — debounced. For the same-doc path, `requestUpdate()` just
   * re-runs `render()`, which reads the canonical's current children fresh
   * every time via `renderChildren`. For the cross-doc path, this also
   * re-checks `_maybeRefreshPreview` (structural changes to the ancestor
   * chain need a new `Query`/`Store`).
   */
  private _subscribeTargetDoc() {
    this._targetDocUnsubscribe?.();
    this._targetDocUnsubscribe = null;

    const refDoc = this.std.workspace.getDoc(this._targetDocId);
    if (!refDoc) return;
    ensureDocLoaded(refDoc);

    const onTargetDocUpdate = () => {
      if (this._refreshDebounce) clearTimeout(this._refreshDebounce);
      this._refreshDebounce = setTimeout(() => {
        this._ensureTrailingParagraph();
        if (this._isCrossDoc) {
          const before = this._previewStore;
          this._maybeRefreshPreview();
          if (this._previewStore !== before) this.requestUpdate();
        } else {
          this.requestUpdate();
        }
      }, 100);
    };
    refDoc.spaceDoc.on('update', onTargetDocUpdate);
    this._targetDocUnsubscribe = () => {
      refDoc.spaceDoc.off('update', onTargetDocUpdate);
    };
  }

  // ---------------------------------------------------------------------
  // Cross-doc path (Story 0.5) — nested `BlockStdScope`, mirroring
  // `database-ref-block.ts`'s own proven mechanism.
  // ---------------------------------------------------------------------

  private _collectSubtreeIds(model: BlockModel, ids: Set<string>) {
    ids.add(model.id);
    for (const child of model.children) {
      this._collectSubtreeIds(child, ids);
    }
  }

  private _getAncestorChain(store: Store, model: BlockModel): string[] {
    const chain: string[] = [];
    let ancestor = store.getParent(model);
    while (ancestor) {
      chain.push(ancestor.id);
      ancestor = store.getParent(ancestor);
    }
    return chain;
  }

  private _sameChain(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
  }

  private _replacePreviewStore(
    store: Store | null,
    refDoc: Store['doc'] | null,
    query: Query | null
  ) {
    if (store === this._previewStore) return;
    if (store) retainPreviewStore(store);
    releasePreviewStore(
      this._previewStore,
      this._previewRefDoc,
      this._previewQuery
    );
    this._previewStore = store;
    this._previewRefDoc = refDoc;
    this._previewQuery = query;
  }

  private _maybeRefreshPreview() {
    const { refBlockId, refDocId } = this.model.props;
    if (!refBlockId || !refDocId) {
      this._resolveError = 'This reference is missing its target.';
      this._replacePreviewStore(null, null, null);
      return;
    }

    const refDoc = this.std.workspace.getDoc(refDocId);
    if (!refDoc) {
      this._resolveError = 'The referenced page could not be found.';
      this._replacePreviewStore(null, null, null);
      return;
    }
    ensureDocLoaded(refDoc);

    const targetStore = refDoc.getStore({ id: refDoc.id });
    const targetModel = targetStore.getBlock(refBlockId)?.model;
    if (!targetModel || targetModel.flavour !== 'affine:note') {
      this._resolveError = 'The referenced note could not be found.';
      this._replacePreviewStore(null, null, null);
      return;
    }

    if (this._wouldRenderCycle(refDocId, refBlockId)) {
      this._resolveError = 'This reference points back to itself.';
      this._replacePreviewStore(null, null, null);
      return;
    }

    const ancestorChain = this._getAncestorChain(targetStore, targetModel);

    if (
      this._previewStore &&
      !this._resolveError &&
      this._sameChain(ancestorChain, this._ancestorChain)
    ) {
      return;
    }

    this._ancestorChain = ancestorChain;

    const displayIds = new Set<string>(ancestorChain);
    this._collectSubtreeIds(targetModel, displayIds);

    const query: Query = {
      mode: 'include',
      match: Array.from(displayIds).map(id => ({
        id,
        viewType: 'display',
      })),
    };

    const nextPreviewStore = refDoc.getStore({ query });
    this._replacePreviewStore(nextPreviewStore, refDoc, query);
    this._resolveError = null;
  }

  /**
   * Same hazard, same fix as `database-ref-block.ts`'s identically-named
   * method: `UIEventDispatcher` tracks exactly one app-wide "active"
   * dispatcher in a *static* field; a pointerdown/click/etc. that bubbles
   * past this wrapper reaches the outer host's own identical listener too,
   * reactivating the outer dispatcher and silently deactivating our nested
   * one every time. Stopping these specific events right at this wrapper's
   * boundary (after the nested dispatcher's own listener, bound further
   * down on the nested host, has already run) prevents that.
   */
  private _stopDispatcherActivationBubbling() {
    const eventNames = [
      'pointerdown',
      'click',
      'focusin',
      'dragover',
      'dragenter',
      'dragstart',
      'drop',
      'pointerenter',
    ];
    const stop = (e: Event) => e.stopPropagation();
    eventNames.forEach(name => this.addEventListener(name, stop));
    this._disposables.add(() =>
      eventNames.forEach(name => this.removeEventListener(name, stop))
    );
  }

  /**
   * Unlike the same-doc path's reactive, selection-aware exclusion, the
   * nested scope's rendered content is never a target for the *outer*
   * std's own `getSelectedModelsCommand`/slash-menu (the nested scope has
   * its own, completely independent selection/command system) — so a
   * permanent blanket exclusion is safe here, exactly like `database-ref`
   * and `surface-ref` already do for their own nested previews.
   */
  private _observeForCrossDocRangeExclusion() {
    this._rangeExcludeObserver?.disconnect();
    this.querySelectorAll('[data-block-id]').forEach(el =>
      el.setAttribute(RANGE_QUERY_EXCLUDE_ATTR, 'true')
    );
    this._rangeExcludeObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node instanceof Element) {
            if (node.hasAttribute('data-block-id')) {
              node.setAttribute(RANGE_QUERY_EXCLUDE_ATTR, 'true');
            }
            node
              .querySelectorAll('[data-block-id]')
              .forEach(el => el.setAttribute(RANGE_QUERY_EXCLUDE_ATTR, 'true'));
          }
        });
      }
    });
    this._rangeExcludeObserver.observe(this, {
      childList: true,
      subtree: true,
    });
  }

  // ---------------------------------------------------------------------

  override connectedCallback() {
    super.connectedCallback();

    if (this._isCrossDoc) {
      this._maybeRefreshPreview();
      this._subscribeTargetDoc();
      this._observeForCrossDocRangeExclusion();
      this._stopDispatcherActivationBubbling();
    } else {
      this._subscribeTargetDoc();
      this._observeForRangeQueryExclusion();

      this._disposables.add(
        this.std.selection.slots.changed.subscribe(() => {
          this._updateRangeQueryExclusion();
        })
      );

      this._disposables.addFromEvent(this, 'pointerdown', () => {
        this._reclaimViewRegistration();
      });
      this._disposables.addFromEvent(this, 'focusin', () => {
        this._reclaimViewRegistration();
      });
    }

    this._disposables.add(
      this.model.propsUpdated.subscribe(({ key }) => {
        if (key === 'refDocId' || key === 'refBlockId') {
          if (this._isCrossDoc) this._maybeRefreshPreview();
          this._subscribeTargetDoc();
          this.requestUpdate();
        } else if (key === 'showBorder' || key === 'backgroundOverride') {
          this.requestUpdate();
        }
      })
    );

    this._disposables.add(() => {
      this._targetDocUnsubscribe?.();
      if (this._refreshDebounce) clearTimeout(this._refreshDebounce);
      this._rangeExcludeObserver?.disconnect();
      this._replacePreviewStore(null, null, null);
    });
  }

  // `showBorder`/`backgroundOverride` style the *host* element itself
  // (`<affine-note-ref>`, matched by `static styles` above) — not some
  // inner wrapper div. `render()`'s returned template only controls this
  // element's light-DOM *content*; the host's own attributes/inline style
  // have to be set imperatively, here, on `this`.
  override updated() {
    const { showBorder, backgroundOverride } = this.model.props;
    this.setAttribute('data-show-border', showBorder ? 'true' : 'false');
    this.style.backgroundColor = backgroundOverride || '';

    // Re-checked after every re-render, not just from the doc-update
    // subscription above: `renderBlock()`'s `canonical.children` read (for
    // the same-doc path) already makes this a `SignalWatcher`-tracked
    // signal, so BlockSuite's own reactivity *already* re-renders this
    // component the moment a new sibling is added anywhere in the
    // canonical (that's the same mechanism that already made "Enter
    // creates a new line" work, entirely independent of the doc-update
    // subscription). Relying solely on that subscription's own debounce
    // turned out to miss the live "insert a non-text block, live, into an
    // already-mounted reference" case in practice — piggybacking on the
    // reactivity that's already proven reliable here instead, rather than
    // trusting a second, parallel signal for the same fact.
    this._ensureTrailingParagraph();
  }

  override renderBlock() {
    if (this._isCrossDoc) {
      if (this._resolveError) {
        return html`<div class="affine-note-ref-error">
          ${this._resolveError}
        </div>`;
      }
      if (!this._previewStore) return nothing;

      return html`${guard([this._previewStore], () => {
        return this._previewStore
          ? new BlockStdScope({
              store: this._previewStore,
              extensions: this._previewSpec,
            }).render()
          : nothing;
      })}`;
    }

    const canonical = this._getCanonical();
    if (!canonical) {
      return html`<div class="affine-note-ref-error">
        The referenced note could not be found.
      </div>`;
    }

    if (
      this._wouldRenderCycle(this._targetDocId, this.model.props.refBlockId)
    ) {
      return html`<div class="affine-note-ref-error">
        This reference points back to itself.
      </div>`;
    }

    return html`${this.std.host.renderChildren(canonical) ?? nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-note-ref': NoteRefBlockComponent;
  }
}
