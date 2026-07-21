import { NoteDisplayMode } from '@blocksuite/affine-model';
import type {
  DatabaseRefProps,
  NoteBlockModel,
} from '@blocksuite/affine-model';
import type { Command } from '@blocksuite/std';
import type { BlockModel, Store } from '@blocksuite/store';

/**
 * Ensures `targetBlock` (an `affine:database`) is safe to reference more
 * than once: if it's still living as an ordinary block in a normal,
 * visible note, this relocates it into a dedicated hidden note
 * (`displayMode: EdgelessOnly`, parked off-canvas — never part of the
 * normal reading/editing flow, mirroring how a Frame lives on the surface
 * rather than in page content) and replaces its old visible position with
 * a `database-ref` pointing at it. From that point on there is no
 * "original" — every visible appearance, old and new, is an equal
 * `database-ref`, and deleting any one of them just removes that view; the
 * underlying data is never reachable by an ordinary text-range deletion.
 *
 * A database whose parent is already an `EdgelessOnly` note is treated as
 * already promoted and left alone — this covers both "we promoted it
 * ourselves earlier" and "the user already had it somewhere hidden for
 * unrelated reasons," since the only invariant this cares about is "not
 * reachable by ordinary in-flow selection," not who put it there.
 */
function ensurePromoted(store: Store, targetBlock: BlockModel): void {
  const parent = store.getParent(targetBlock);
  if (
    parent &&
    parent.flavour === 'affine:note' &&
    (parent as NoteBlockModel).props.displayMode ===
      NoteDisplayMode.EdgelessOnly
  ) {
    return;
  }

  const oldIndex = parent ? parent.children.indexOf(targetBlock) : -1;

  const root = store.root;
  if (!root) return;

  const hiddenNoteId = store.addBlock(
    'affine:note',
    {
      displayMode: NoteDisplayMode.EdgelessOnly,
      // `xywh` is only load-bearing for the edgeless canvas (e.g. where a
      // "jump to source" affordance would frame it); the renderer
      // (`database-ref-block.ts`) mounts this note's content through a
      // page-mode nested scope, which sizes to its own content and doesn't
      // consult this bound at all.
      xywh: '[-10000, -10000, 800, 480]',
    },
    root.id
  );
  const hiddenNote = store.getModelById(hiddenNoteId);
  if (!hiddenNote) return;

  store.moveBlocks([targetBlock], hiddenNote);

  if (parent && oldIndex !== -1) {
    store.addBlock(
      'affine:database-ref',
      { refBlockId: targetBlock.id, refDocId: store.id },
      parent,
      oldIndex
    );
  }
}

export const insertDatabaseRefBlockCommand: Command<
  {
    refBlockId: string;
    place: 'after' | 'before';
    removeEmptyLine?: boolean;
    selectedModels?: BlockModel[];
  },
  {
    insertedDatabaseRefBlockId: string;
  }
> = (ctx, next) => {
  const { selectedModels, refBlockId, place, removeEmptyLine, std } = ctx;
  if (!selectedModels?.length) return;

  const targetModel =
    place === 'before'
      ? selectedModels[0]
      : selectedModels[selectedModels.length - 1];

  const store = std.store;
  const targetBlock = store.getBlock(refBlockId)?.model;
  if (!targetBlock || targetBlock.flavour !== 'affine:database') {
    console.error(`referenced database block not found ${refBlockId}`);
    return;
  }

  store.captureSync();

  ensurePromoted(store, targetBlock);

  const databaseRefProps: Partial<DatabaseRefProps> & {
    flavour: 'affine:database-ref';
  } = {
    flavour: 'affine:database-ref',
    refBlockId: targetBlock.id,
    refDocId: store.id,
  };

  const result = store.addSiblingBlocks(targetModel, [databaseRefProps], place);
  if (result.length === 0) return;

  if (removeEmptyLine && targetModel.text?.length === 0) {
    store.deleteBlock(targetModel);
  }

  next({
    insertedDatabaseRefBlockId: result[0],
  });
};
