import { toast } from '@blocksuite/affine-components/toast';
import {
  createReusableNoteAndInsertRefCommand,
  insertNoteRefBlockCommand,
} from '@blocksuite/affine-block-note-ref';
import type { Color, NoteBlockModel } from '@blocksuite/affine-model';
import { DefaultTheme } from '@blocksuite/affine-model';
import { CrossDocReferenceProvider } from '@blocksuite/affine-shared/services';
import { getLastNoteBlock } from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/std';
import { BlockSelection } from '@blocksuite/std';
import type { BlockModel, Store } from '@blocksuite/store';

import type { DatabaseBlockDataSource } from '../../data-source.js';
import type { NoteRefValue } from './define.js';

// White/Transparent are poor choices for "make this row visually distinct"
// — White is indistinguishable from the table's own default background,
// Transparent shows no color at all.
const EXCLUDED_COLOR_KEYS = new Set(['White', 'Transparent']);

// Raw theme `Color` tokens (e.g. `{dark, light}`) straight from AFFiNE's own
// note-background palette — never resolved to a literal CSS string here.
// A resolved value bakes in whichever light/dark scheme happened to be
// active at pick time; storing the token instead and resolving it at
// render time (`note-ref-block.ts`'s `updated()`, `list/pc/renderer.ts`'s
// row style) keeps every note/note-ref/row in sync with the *current*
// theme, exactly like the canonical note's own `pageBackgroundOverride`.
function candidateColors(): Color[] {
  return Object.entries(DefaultTheme.NoteBackgroundColorMap)
    .filter(([key]) => !EXCLUDED_COLOR_KEYS.has(key))
    .map(([, color]) => color);
}

/**
 * Picks a color for a row's Note, avoiding colors already in use on this
 * page — other rows' own Note color, and any on-page note's own non-default
 * `pageBackgroundOverride` — falling back to any candidate once the small
 * fixed palette is exhausted. Story 2.6's Resolved Design Decision 7.
 * Compares raw tokens (`JSON.stringify`) rather than resolved strings —
 * candidates come from the same fixed `NoteBackgroundColorMap`, so token
 * equality is exactly what "already in use" means here, independent of
 * whatever theme happens to be active right now.
 */
export function pickNoteColor(
  std: BlockStdScope,
  dataSource: DatabaseBlockDataSource
): Color {
  const inUse = new Set<string>(
    dataSource.getAllNoteColors().map(color => JSON.stringify(color))
  );
  for (const note of std.store.getBlocksByFlavour('affine:note')) {
    const model = note.model as NoteBlockModel;
    if (model.props.pageBackgroundOverride) {
      inUse.add(JSON.stringify(model.props.pageBackgroundOverride));
    }
  }

  const candidates = candidateColors();
  const unused = candidates.find(color => !inUse.has(JSON.stringify(color)));
  if (unused) return unused;
  const first = candidates[0];
  if (first) return first;
  // `NoteBackgroundColorMap`'s own type is a generic `Record<string, Color>`
  // (from its zod schema), so a literal property access like `.White`
  // widens to `Color | undefined` under this package's
  // `noUncheckedIndexedAccess` — the key genuinely always exists at
  // runtime (it's part of the literal object `default.ts` declares), this
  // branch is only reachable if `candidateColors()` somehow returned an
  // empty array.
  return DefaultTheme.NoteBackgroundColorMap.White as Color;
}

/**
 * Resolves (creating if necessary) a block to use as the sibling anchor
 * `note-ref`'s own commands require (`selectedModels`) so a new/attached
 * block always lands after all existing content on the page — mirrors
 * `appendParagraphCommand`'s own "no visible note yet" fallback
 * (`getLastNoteBlock`, then create one), extended with an empty-note
 * fallback of its own (an anchor must be a real child block, not the note
 * itself, unlike `appendParagraphCommand`, which inserts directly into the
 * note by id rather than as a sibling of one of its children).
 */
function resolveEndOfPageAnchor(std: BlockStdScope): BlockModel | undefined {
  const store = std.store;
  if (!store.root) return undefined;

  let note: NoteBlockModel | null | undefined = getLastNoteBlock(store);
  if (!note) {
    const noteId = store.addBlock('affine:note', {}, store.root.id);
    note = store.getBlock(noteId)?.model as NoteBlockModel | undefined;
  }
  if (!note) return undefined;

  const lastChild = note.children[note.children.length - 1];
  if (lastChild) return lastChild;

  const paragraphId = store.addBlock('affine:paragraph', {}, note.id);
  return store.getBlock(paragraphId)?.model;
}

/**
 * Matches `noteRefSlashMenuConfig`'s own `newNoteItem`/`sameDocItems`
 * actions exactly (`note-ref/src/configs/slash-menu.ts`) — the working,
 * already-shipped reference behavior this story's own note-linking is
 * meant to feel identical to. A cross-doc note-ref mounts its own,
 * genuinely separate nested `BlockStdScope` (`note-ref-block.ts`'s own
 * `_isCrossDoc` path) with its own dispatcher/selection manager; setting a
 * `TextSelection` via the *outer* `std` has no effect on that nested
 * scope's own focus tracking, so anything beyond this plain
 * `BlockSelection` risks doing the wrong thing silently for exactly the
 * cross-doc case this story cares about most (a task carried over from an
 * earlier day's page).
 */
function focusInsertedRef(std: BlockStdScope, blockId: string) {
  std.selection.set([std.selection.create(BlockSelection, { blockId })]);
}

/**
 * Applies the row's chosen color to the just-inserted `note-ref` block
 * itself — `note-ref`'s own background/border are genuinely per-instance
 * props (`NoteRefProps.backgroundOverride`, a theme `Color` token, resolved
 * at render time), separate from the canonical note's own
 * `pageBackgroundOverride` (also a `Color`, resolved separately by
 * `note-block.ts`); setting only the canonical's prop (an earlier version
 * of this file's own mistake) never renders anything, since
 * `note-ref-block.ts`'s own rendering reads exclusively from its own
 * model's `backgroundOverride` (see `note-ref-block.ts`'s `updated()`),
 * never the canonical's.
 * Every fresh instance of a note-ref for this row (create, attach, or a
 * later carryover insert on a different page) gets the SAME color applied
 * here — consistent with the "seed once per instance, no live sync"
 * pattern already established for the canonical's own color.
 */
function applyNoteRefColor(
  std: BlockStdScope,
  noteRefBlockId: string,
  color: Color
) {
  const refModel = std.store.getBlock(noteRefBlockId)?.model as
    | { props: { backgroundOverride?: Color; showBorder?: boolean } }
    | undefined;
  if (!refModel) return;
  std.store.updateBlock(refModel as never, {
    backgroundOverride: color,
    showBorder: true,
  });
}

function resolveCanonicalStore(
  std: BlockStdScope,
  refDocId: string
): Store | undefined {
  return refDocId === std.store.id
    ? std.store
    : std.workspace.getDoc(refDocId)?.getStore({ id: refDocId });
}

function noteRefExistsOnCurrentPage(
  std: BlockStdScope,
  refBlockId: string
): BlockModel | undefined {
  return std.store
    .getBlocksByFlavour('affine:note-ref')
    .find(
      block =>
        (block.model as unknown as { props: { refBlockId: string } }).props
          .refBlockId === refBlockId
    )?.model;
}

/**
 * Scrolls an already-rendered block into view instead of inserting a
 * duplicate `note-ref` for the same canonical note — Story 2.6's Resolved
 * Design Decision 6. No existing precedent for this exact interaction was
 * found in this codebase; kept intentionally simple (direct DOM lookup by
 * block id, standard smooth-scroll), no new infrastructure.
 */
function revealBlock(std: BlockStdScope, blockId: string) {
  const element = std.host.querySelector(`[data-block-id="${blockId}"]`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Empty-cell "+" action (AC1): creates a fresh canonical note named
 * `Journal: <row text>`, appends its `note-ref` at the end of the page,
 * assigns a color to both the row and the note, and writes the reference
 * back to the row.
 */
export function createNoteForRow(
  std: BlockStdScope,
  dataSource: DatabaseBlockDataSource,
  rowId: string
): void {
  const anchor = resolveEndOfPageAnchor(std);
  if (!anchor) {
    toast(std.host, 'Could not create a note here.');
    return;
  }

  const [, result] = std.command.exec(createReusableNoteAndInsertRefCommand, {
    place: 'after',
    selectedModels: [anchor],
  });
  if (!result.insertedNoteRefBlockId) {
    toast(std.host, 'Could not create a note here.');
    return;
  }

  const refModel = std.store.getBlock(result.insertedNoteRefBlockId)?.model as
    | { props: { refDocId?: string; refBlockId: string } }
    | undefined;
  if (!refModel) return;

  const refDocId = refModel.props.refDocId ?? std.store.id;
  const refBlockId = refModel.props.refBlockId;
  const canonicalStore = resolveCanonicalStore(std, refDocId);
  const canonical = canonicalStore?.getBlock(refBlockId)?.model as
    | NoteBlockModel
    | undefined;

  const rowText = std.store.getModelById(rowId)?.text?.toString() ?? '';
  const color = pickNoteColor(std, dataSource);
  if (canonical && canonicalStore) {
    canonicalStore.updateBlock(canonical, {
      name: `Journal: ${rowText}`,
      pageBackgroundOverride: color,
    });
  }
  applyNoteRefColor(std, result.insertedNoteRefBlockId, color);

  dataSource.setNoteRef(rowId, { refDocId, refBlockId });
  dataSource.setNoteColor(rowId, color);
  focusInsertedRef(std, result.insertedNoteRefBlockId);
}

/**
 * Populated-cell action (AC2): reveals the existing `note-ref` if one for
 * this exact `refBlockId` already exists on the current page, otherwise
 * inserts one at the end of the page — never creates a new canonical note
 * or a duplicate `note-ref`.
 */
export function revealOrInsertNoteForRow(
  std: BlockStdScope,
  dataSource: DatabaseBlockDataSource,
  rowId: string
): void {
  const ref = dataSource.getNoteRef(rowId);
  if (!ref) return;

  const existing = noteRefExistsOnCurrentPage(std, ref.refBlockId);
  if (existing) {
    revealBlock(std, existing.id);
    return;
  }

  const anchor = resolveEndOfPageAnchor(std);
  if (!anchor) {
    toast(std.host, 'Could not insert this note here.');
    return;
  }

  const isCrossDoc = ref.refDocId !== std.store.id;
  const [, result] = std.command.exec(insertNoteRefBlockCommand, {
    refBlockId: ref.refBlockId,
    refDocId: isCrossDoc ? ref.refDocId : undefined,
    place: 'after',
    selectedModels: [anchor],
  });
  if (!result.insertedNoteRefBlockId) {
    toast(std.host, 'Could not insert this note here.');
    return;
  }
  // Reuses the row's already-chosen color (set once, at first creation/
  // attachment) rather than picking a new one — this is the exact
  // carryover case: a task already linked to a note on an earlier day,
  // now getting its first `note-ref` instance on a *different* page.
  const color = dataSource.getNoteColor(rowId);
  if (color) {
    applyNoteRefColor(std, result.insertedNoteRefBlockId, color);
  }
  focusInsertedRef(std, result.insertedNoteRefBlockId);
}

/**
 * "Attach existing note" action (AC3): opens the cross-doc reference
 * picker restricted to `affine:note`, and on a valid pick, inserts a
 * `note-ref` for it at the end of the page and assigns a color exactly as
 * `createNoteForRow` does (this is the note's first attachment to this
 * row, even though the note itself isn't new).
 */
export async function attachExistingNoteForRow(
  std: BlockStdScope,
  dataSource: DatabaseBlockDataSource,
  rowId: string
): Promise<void> {
  const crossDocReference = std.getOptional(CrossDocReferenceProvider);
  if (!crossDocReference) {
    toast(std.host, 'Cross-doc referencing is not available.');
    return;
  }

  const candidate = await crossDocReference.openCrossDocReferencePicker(
    std.store.id,
    ['affine:note']
  );
  if (!candidate) return;
  if (candidate.flavour !== 'affine:note') {
    toast(std.host, 'Could not attach that as a note.');
    return;
  }

  const anchor = resolveEndOfPageAnchor(std);
  if (!anchor) {
    toast(std.host, 'Could not attach this note here.');
    return;
  }

  const isCrossDoc = candidate.docId !== std.store.id;
  const [, result] = std.command.exec(insertNoteRefBlockCommand, {
    refBlockId: candidate.blockId,
    refDocId: isCrossDoc ? candidate.docId : undefined,
    place: 'after',
    selectedModels: [anchor],
  });
  if (!result.insertedNoteRefBlockId) {
    toast(std.host, 'Could not attach this note here.');
    return;
  }

  const color = pickNoteColor(std, dataSource);
  const canonicalStore = resolveCanonicalStore(std, candidate.docId);
  const canonical = canonicalStore?.getBlock(candidate.blockId)?.model as
    | NoteBlockModel
    | undefined;
  if (canonical && canonicalStore) {
    canonicalStore.updateBlock(canonical, { pageBackgroundOverride: color });
  }
  applyNoteRefColor(std, result.insertedNoteRefBlockId, color);

  dataSource.setNoteRef(rowId, {
    refDocId: candidate.docId,
    refBlockId: candidate.blockId,
  });
  dataSource.setNoteColor(rowId, color);
  focusInsertedRef(std, result.insertedNoteRefBlockId);
}

export type { NoteRefValue };
