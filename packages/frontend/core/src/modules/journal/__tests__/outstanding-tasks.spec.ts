import { createTaskIdentity } from '@blocksuite/affine-shared/utils';
import { describe, expect, test } from 'vitest';

import {
  buildCarryForwardPlan,
  createDatabaseOutstandingTaskCandidate,
  createTodoOutstandingTaskCandidate,
  evaluateJournalTaskSourceModels,
  resolveOutstandingTasks,
} from '../utils/outstanding-tasks';

const taskIdentity = (blockId: string, docId = 'doc') =>
  createTaskIdentity({ docId, blockId });

describe('journal outstanding tasks', () => {
  test('evaluates candidate models and recommends aggregated sources', () => {
    const evaluation = evaluateJournalTaskSourceModels();

    expect(evaluation.recommendedModel).toBe('aggregated-task-sources');
    expect(evaluation.models.map(model => model.id)).toEqual([
      'single-default-task-database',
      'aggregated-task-sources',
      'aggregated-task-sources-plus-standalone-todos',
      'journal-local-todo-clones',
    ]);
    expect(
      evaluation.models.find(model => model.id === 'aggregated-task-sources')
        ?.strengths
    ).toContain('Supports multiple project and epic task databases');
  });

  test('filters completed tasks and deduplicates by task identity', () => {
    const result = resolveOutstandingTasks([
      {
        taskIdentity: taskIdentity('todo-1'),
        docId: 'doc',
        blockId: 'todo-1',
        sourceFlavor: 'affine:list',
        title: 'Todo 1',
        checked: false,
        sourceType: 'todo',
      },
      {
        taskIdentity: taskIdentity('todo-2'),
        docId: 'doc',
        blockId: 'todo-2',
        sourceFlavor: 'affine:list',
        title: 'Todo 2',
        checked: true,
        sourceType: 'todo',
      },
      {
        taskIdentity: taskIdentity('row-1'),
        docId: 'doc',
        blockId: 'row-1',
        sourceFlavor: 'affine:paragraph',
        title: 'Done row',
        checked: true,
        statusSemantic: 'done',
        sourceType: 'database',
        databaseId: 'db',
        databaseRowId: 'row-1',
      },
      {
        taskIdentity: taskIdentity('row-2'),
        docId: 'doc',
        blockId: 'row-2',
        sourceFlavor: 'affine:paragraph',
        title: 'Open row',
        checked: false,
        statusSemantic: 'in_progress',
        sourceType: 'database',
        databaseId: 'db',
        databaseRowId: 'row-2',
      },
      {
        taskIdentity: taskIdentity('todo-1'),
        docId: 'doc',
        blockId: 'duplicate',
        sourceFlavor: 'affine:list',
        title: 'Duplicate Todo 1',
        checked: false,
        sourceType: 'todo',
      },
    ]);

    expect(result.tasks.map(task => task.title)).toEqual(['Open row']);
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'completed' }),
        expect.objectContaining({ reason: 'duplicate-task-identity' }),
      ])
    );
  });

  test('creates TODO and database candidates from existing task identity contracts', () => {
    expect(
      createTodoOutstandingTaskCandidate({
        docId: 'journal',
        blockId: 'todo-1',
        title: 'Plan day',
        checked: false,
      })
    ).toEqual(
      expect.objectContaining({
        taskIdentity: taskIdentity('todo-1', 'journal'),
        sourceType: 'todo',
        sourceFlavor: 'affine:list',
        checked: false,
      })
    );

    expect(
      createDatabaseOutstandingTaskCandidate({
        docId: 'project',
        databaseId: 'db',
        rowId: 'row-1',
        title: 'Ship feature',
        statusInfo: {
          semantic: 'in_progress',
          checked: false,
        },
      })
    ).toEqual(
      expect.objectContaining({
        taskIdentity: taskIdentity('row-1', 'project'),
        sourceType: 'database',
        sourceFlavor: 'affine:paragraph',
        statusSemantic: 'in_progress',
        databaseId: 'db',
        databaseRowId: 'row-1',
      })
    );
  });

  test('builds traceable carry-forward entries from outstanding tasks', () => {
    const plan = buildCarryForwardPlan([
      {
        taskIdentity: taskIdentity('todo-1'),
        docId: 'journal-yesterday',
        blockId: 'todo-1',
        sourceFlavor: 'affine:list',
        title: 'Pay invoice',
        checked: false,
        sourceType: 'todo',
      },
      {
        taskIdentity: taskIdentity('row-1'),
        docId: 'project-page',
        blockId: 'row-1',
        sourceFlavor: 'affine:paragraph',
        title: 'Create hero section',
        checked: false,
        sourceType: 'database',
        databaseId: 'db',
        databaseRowId: 'row-1',
        parentTitle: 'Design landing page',
        epicTitle: 'Launch Website',
      },
    ]);

    expect(plan.heading).toBe('Outstanding Tasks');
    expect(plan.entries).toEqual([
      expect.objectContaining({
        title: 'Pay invoice',
        taskIdentity: taskIdentity('todo-1'),
        reference: {
          pageId: 'journal-yesterday',
          params: { blockIds: ['todo-1'] },
        },
      }),
      expect.objectContaining({
        title: 'Create hero section',
        context: ['Epic: Launch Website', 'Parent: Design landing page'],
        reference: {
          pageId: 'project-page',
          params: { databaseId: 'db', databaseRowId: 'row-1' },
        },
      }),
    ]);
  });
});
