import { describe, expect, it } from 'vitest';

import {
  createDatabaseRowTaskInteropLink,
  createTodoTaskInteropLink,
  findDuplicateTaskIdentities,
  hasSameTaskIdentity,
  parseTaskIdentity,
} from '../../utils/task-interop.js';

describe('task interop flow', () => {
  it('keeps identity stable across reorder-like row movement', () => {
    const before = createDatabaseRowTaskInteropLink({
      docId: 'doc-1',
      blockId: 'row-42',
      databaseId: 'db-1',
    });

    // Reorder should not mutate block identity.
    const after = createDatabaseRowTaskInteropLink({
      docId: 'doc-1',
      blockId: 'row-42',
      databaseId: 'db-1',
    });

    expect(before.taskIdentity).toBe(after.taskIdentity);
    expect(parseTaskIdentity(before.taskIdentity)).toEqual({
      spaceId: undefined,
      docId: 'doc-1',
      blockId: 'row-42',
    });
  });

  it('resolves linked TODO and DB records to same logical task', () => {
    const todo = createTodoTaskInteropLink({
      docId: 'doc-main',
      blockId: 'task-100',
      sourceFlavor: 'affine:list',
    });

    const db = createDatabaseRowTaskInteropLink({
      docId: 'doc-main',
      blockId: 'task-100',
      databaseId: 'db-main',
      sourceFlavor: 'affine:paragraph',
    });

    expect(hasSameTaskIdentity(todo, db)).toBe(true);
  });

  it('detects duplicate identities deterministically', () => {
    const a = createTodoTaskInteropLink({ docId: 'd', blockId: 'b1' });
    const b = createDatabaseRowTaskInteropLink({
      docId: 'd',
      blockId: 'b1',
      databaseId: 'db',
    });
    const c = createTodoTaskInteropLink({ docId: 'd', blockId: 'b2' });

    const duplicates = findDuplicateTaskIdentities([a, b, c]);
    expect(duplicates).toEqual(['d:b1']);
  });
});
