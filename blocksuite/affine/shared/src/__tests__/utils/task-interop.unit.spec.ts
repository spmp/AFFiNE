import { describe, expect, it } from 'vitest';

import {
  createDatabaseRowTaskInteropLink,
  createTaskIdentity,
  createTodoTaskInteropLink,
  hasSameTaskIdentity,
  parseTaskIdentity,
  TASK_INTEROP_UPDATED_EVENT,
} from '../../utils/task-interop.js';

describe('task interop identity', () => {
  it('creates identity from doc and block', () => {
    expect(createTaskIdentity({ docId: 'd1', blockId: 'b1' })).toBe('d1:b1');
  });

  it('creates identity with space prefix', () => {
    expect(
      createTaskIdentity({ spaceId: 's1', docId: 'd1', blockId: 'b1' })
    ).toBe('s1:d1:b1');
  });

  it('parses 2-part identity', () => {
    expect(parseTaskIdentity('d1:b1')).toEqual({
      spaceId: undefined,
      docId: 'd1',
      blockId: 'b1',
    });
  });

  it('parses 3-part identity', () => {
    expect(parseTaskIdentity('s1:d1:b1')).toEqual({
      spaceId: 's1',
      docId: 'd1',
      blockId: 'b1',
    });
  });

  it('returns null for invalid identity', () => {
    expect(parseTaskIdentity('a:b:c:d')).toBeNull();
  });

  it('encodes and decodes separators safely', () => {
    const identity = createTaskIdentity({
      spaceId: 'space:1',
      docId: 'doc:2',
      blockId: 'block:3',
    });
    expect(identity).not.toBe('space:1:doc:2:block:3');
    expect(parseTaskIdentity(identity)).toEqual({
      spaceId: 'space:1',
      docId: 'doc:2',
      blockId: 'block:3',
    });
  });
});

describe('task interop links', () => {
  it('creates todo link with stable identity', () => {
    const link = createTodoTaskInteropLink({ docId: 'doc', blockId: 'todo' });
    expect(link.taskIdentity).toBe('doc:todo');
    expect(link.sourceFlavor).toBe('affine:list');
  });

  it('creates database row link with row id mapping', () => {
    const link = createDatabaseRowTaskInteropLink({
      docId: 'doc',
      blockId: 'row-1',
      databaseId: 'db-1',
    });
    expect(link.databaseRowId).toBe('row-1');
    expect(link.databaseId).toBe('db-1');
  });

  it('compares task identity across surfaces', () => {
    const todo = createTodoTaskInteropLink({
      docId: 'doc',
      blockId: 'b1',
      databaseId: 'db-1',
      databaseRowId: 'row-1',
    });
    const db = createDatabaseRowTaskInteropLink({
      docId: 'doc',
      blockId: 'b1',
      databaseId: 'db-1',
    });
    expect(hasSameTaskIdentity(todo, db)).toBe(true);
  });

  it('exports a stable event name', () => {
    expect(TASK_INTEROP_UPDATED_EVENT).toBe('affine:task-interop-updated');
  });
});
