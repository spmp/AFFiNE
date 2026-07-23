import type { NoteRefBlockModel } from '@blocksuite/affine-model';
import { BlockComponent, TextSelection } from '@blocksuite/std';
import { RANGE_QUERY_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import type { BlockModel } from '@blocksuite/store';
import { css, html, nothing } from 'lit';

/**
 * Renders a live view of a single `affine:note` block, addressed by
 * `refBlockId` + `refDocId` (defaults to the current doc — Story 0.6 is
 * same-doc-only; a real foreign doc id is a future story's job).
 *
 * Deliberately the *thinnest possible* mechanism: `BlockComponent` (the
 * base class every block, including `affine-note`'s own, extends) picks up
 * `std`/`store` via Lit's `@consume({context})` — resolved from whichever
 * `EditorHost` is its nearest DOM ancestor, not from however it got added
 * to that DOM. So rendering the canonical note's children here, through
 * `this.std.host.renderChildren(canonical)`, uses the exact same std,
 * store, dispatcher, selection/range manager, and keymaps as any other
 * block on the page — no nested `BlockStdScope`, no `Query`-filtered
 * second `Store`, no synchronization between "the real data" and "what's
 * rendered" to ever get out of sync, because there is only ever one of
 * each. Typing, Enter, markdown shortcuts, and the text's own formatting
 * toolbar all work identically to normal content, because this *is*
 * normal content — just addressed by a different id than this block's own
 * `parent.children` would otherwise reach.
 *
 * An earlier version of this component reused `database-ref`'s nested
 * `BlockStdScope` + `Query`-filtered `Store` technique instead. That
 * turned out not to generalize from Database to Note: Database's own
 * cell/row editing doesn't go through BlockSuite's generic rich-text
 * inline editor at all (`DatabaseBlockDataSource` reads/writes
 * `children` directly), so it never depended on the nested scope's own
 * dispatcher/selection system working correctly. Note's paragraphs do —
 * and live user testing found the nested inline editor's keystrokes
 * simply never reached the underlying Yjs `Text` at all in that
 * architecture (confirmed live: canonical text stayed empty after typing
 * and pressing Enter, despite visible characters on screen — a bare
 * `contenteditable` DOM illusion with nothing behind it), on top of a
 * separate `Query`-staleness bug (new children never entered the
 * statically-computed `match` list). Rendering directly through the
 * outer host sidesteps both categories of bug at once, by construction,
 * rather than patching either one.
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

  private get _targetDocId(): string {
    return this.model.props.refDocId || this.std.store.id;
  }

  private _getCanonical(): BlockModel | null {
    const refDoc = this.std.workspace.getDoc(this._targetDocId);
    if (!refDoc) return null;
    if (!refDoc.ready) refDoc.load();

    // Same-doc only for now (Story 0.6 scope) — `this.std.store` is
    // already the correct, single shared store for the current doc.
    const targetStore =
      refDoc === this.std.store.doc
        ? this.std.store
        : refDoc.getStore({ id: refDoc.id });

    const canonical = targetStore.getBlock(this.model.props.refBlockId)?.model;
    if (!canonical || canonical.flavour !== 'affine:note') return null;
    return canonical;
  }

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

    this.std.store.captureSync();
    this.std.store.addBlock('affine:paragraph', {}, canonical.id);
  }

  /**
   * There's no dedicated "a different note's children changed" signal to
   * subscribe to directly, so this falls back to the doc's raw Yjs
   * `update` event (fires on any change in the doc, not just this
   * canonical) — debounced, and unconditional (no cached Query/ancestor
   * state to compare against this time, since there isn't any) —
   * `requestUpdate()` just re-runs `render()`, which reads the canonical's
   * current children fresh every time via `renderChildren`.
   */
  private _subscribeTargetDoc() {
    this._targetDocUnsubscribe?.();
    this._targetDocUnsubscribe = null;

    const refDoc = this.std.workspace.getDoc(this._targetDocId);
    if (!refDoc) return;
    if (!refDoc.ready) refDoc.load();

    const onTargetDocUpdate = () => {
      if (this._refreshDebounce) clearTimeout(this._refreshDebounce);
      this._refreshDebounce = setTimeout(() => {
        this._ensureTrailingParagraph();
        this.requestUpdate();
      }, 100);
    };
    refDoc.spaceDoc.on('update', onTargetDocUpdate);
    this._targetDocUnsubscribe = () => {
      refDoc.spaceDoc.off('update', onTargetDocUpdate);
    };
  }

  override connectedCallback() {
    super.connectedCallback();
    this._subscribeTargetDoc();
    this._observeForRangeQueryExclusion();
    // Not called here directly — `updated()` (below) already runs it after
    // every render, including the first one.

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

    this._disposables.add(
      this.model.propsUpdated.subscribe(({ key }) => {
        if (key === 'refDocId' || key === 'refBlockId') {
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
    // subscription below: `renderBlock()`'s `canonical.children` read
    // already makes this a `SignalWatcher`-tracked signal, so BlockSuite's
    // own reactivity *already* re-renders this component the moment a new
    // sibling is added anywhere in the canonical (that's the same
    // mechanism that already made "Enter creates a new line" work,
    // entirely independent of the doc-update subscription). Relying solely
    // on that subscription's own debounce (below) turned out to miss the
    // live "insert a non-text block, live, into an already-mounted
    // reference" case in practice — piggybacking on the reactivity that's
    // already proven reliable here instead, rather than trusting a second,
    // parallel signal for the same fact.
    this._ensureTrailingParagraph();
  }

  override renderBlock() {
    const canonical = this._getCanonical();
    if (!canonical) {
      return html`<div class="affine-note-ref-error">
        The referenced note could not be found.
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
