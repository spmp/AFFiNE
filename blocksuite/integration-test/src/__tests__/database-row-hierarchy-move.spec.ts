import { Text } from '@blocksuite/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { addNote } from './utils/edgeless.js';
import { setupEditor } from './utils/setup.js';

// Phase 3 (LIST-05, D-02): `DatabaseBlockDataSource.rowMove`'s self-collision
// branch (`if (target?.id === rowId) { return; }`) used to silently drop any
// pending hierarchy level set via `setPendingHierarchyLevel` just before the
// call, whenever the resolved drop target collided with the row's own
// current position (e.g. dragging a row onto its immediately-preceding
// sibling — no real reorder needed). It now falls through to
// `applyPendingHierarchyLevel` (Phase 2's CR-01 fix, already used by the
// keyboard-toolbar's indent/outdent buttons) so the level change still
// commits.
describe('DatabaseBlockDataSource.rowMove self-collision hardening (Phase 3, LIST-05/D-02)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page');
    return cleanup;
  });

  async function seedThreeTodoRows() {
    const { DatabaseBlockDataSource } =
      await import('@blocksuite/affine/blocks/database');

    const noteId = addNote(doc);
    const databaseId = doc.addBlock(
      'affine:database',
      { title: new Text() },
      noteId
    );

    const dbModel = doc.getModelById(databaseId)!;
    const datasource = new DatabaseBlockDataSource(dbModel as never);

    const rowA = datasource.rowAddAsTodoList('end');
    const rowB = datasource.rowAddAsTodoList('end');
    const rowC = datasource.rowAddAsTodoList('end');

    return { dbModel, datasource, rowA, rowB, rowC };
  }

  test('dragging a row onto its immediately-preceding sibling (collision, no real reorder) still commits the pending level', async () => {
    const { dbModel, datasource, rowA, rowB, rowC } = await seedThreeTodoRows();

    // C's immediately-preceding sibling is B. Dropping C with `before:
    // false` relative to B resolves to C's own current index — the exact
    // self-collision case this fix targets.
    datasource.setPendingHierarchyLevel(rowC, 1);
    datasource.rowMove(rowC, { id: rowB, before: false });

    expect(datasource.getRowHierarchyLevel(rowC)).toBe(1);
    // Row order is unchanged — no real reorder happened, only the level.
    expect(dbModel.children.map(child => child.id)).toEqual([rowA, rowB, rowC]);
  });

  test('a genuine reposition (target is a different row) still moves the row exactly as before', async () => {
    const { dbModel, datasource, rowA, rowB, rowC } = await seedThreeTodoRows();

    datasource.rowMove(rowC, { id: rowA, before: true });

    expect(dbModel.children.map(child => child.id)).toEqual([rowC, rowA, rowB]);
  });
});
