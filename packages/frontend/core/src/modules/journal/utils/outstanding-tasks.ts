import type { TaskInteropLink } from '@blocksuite/affine-shared/utils';
import {
  createDatabaseRowTaskInteropLink,
  createTodoTaskInteropLink,
  findDuplicateTaskIdentities,
} from '@blocksuite/affine-shared/utils';

type TaskStatusSemantic = 'none' | 'todo' | 'in_progress' | 'done';

type JournalTaskSourceType = 'todo' | 'database';

export type OutstandingTaskCandidate = TaskInteropLink & {
  checked: boolean;
  sourceType: JournalTaskSourceType;
  statusSemantic?: TaskStatusSemantic;
  parentTitle?: string;
  epicTitle?: string;
};

export type TaskStatusInfoLike = {
  semantic: TaskStatusSemantic;
  checked: boolean;
};

export const createTodoOutstandingTaskCandidate = (input: {
  docId: string;
  blockId: string;
  title?: string;
  checked: boolean;
  cost?: number;
}): OutstandingTaskCandidate => ({
  ...createTodoTaskInteropLink(input),
  checked: input.checked,
  sourceType: 'todo',
});

export const createDatabaseOutstandingTaskCandidate = (input: {
  docId: string;
  databaseId: string;
  rowId: string;
  title?: string;
  sourceFlavor?: string;
  statusInfo: TaskStatusInfoLike;
  parentTitle?: string;
  epicTitle?: string;
}): OutstandingTaskCandidate => ({
  ...createDatabaseRowTaskInteropLink({
    docId: input.docId,
    blockId: input.rowId,
    databaseId: input.databaseId,
    sourceFlavor: input.sourceFlavor,
  }),
  title: input.title,
  checked: input.statusInfo.checked,
  statusSemantic: input.statusInfo.semantic,
  sourceType: 'database',
  parentTitle: input.parentTitle,
  epicTitle: input.epicTitle,
});

export type OutstandingTask = OutstandingTaskCandidate & {
  title: string;
};

export type ExcludedOutstandingTask = {
  task: OutstandingTaskCandidate;
  reason: 'completed' | 'duplicate-task-identity' | 'missing-title';
};

export type JournalTaskSourceModelId =
  | 'single-default-task-database'
  | 'aggregated-task-sources'
  | 'aggregated-task-sources-plus-standalone-todos'
  | 'journal-local-todo-clones';

export type JournalTaskSourceModelEvaluation = {
  id: JournalTaskSourceModelId;
  label: string;
  strengths: string[];
  weaknesses: string[];
};

export const evaluateJournalTaskSourceModels = () => ({
  recommendedModel: 'aggregated-task-sources' as JournalTaskSourceModelId,
  fallbackWriteTarget: 'default-journal-task-database',
  models: [
    {
      id: 'single-default-task-database',
      label: 'Single default master task database',
      strengths: [
        'Simple user mental model',
        'Strong analytics support through one task table',
        'Clear fallback write target for new journal tasks',
      ],
      weaknesses: [
        'Can become a global catch-all database',
        'Less natural for project-local task databases',
      ],
    },
    {
      id: 'aggregated-task-sources',
      label: 'Aggregated opted-in task-capable databases',
      strengths: [
        'Supports multiple project and epic task databases',
        'Keeps task rows near their project context',
        'Treats the default journal task list as a special source, not the only source',
      ],
      weaknesses: [
        'Requires source discovery and opt-in or schema detection',
        'Needs source context in the journal UI',
      ],
    },
    {
      id: 'aggregated-task-sources-plus-standalone-todos',
      label: 'Aggregated task databases plus standalone TODO fallback',
      strengths: [
        'Preserves lightweight TODO capture',
        'Provides a migration path from TODOs to database-backed tasks',
      ],
      weaknesses: [
        'Harder to dedupe across TODO and database representations',
        'Standalone TODOs have weaker analytics unless promoted or enriched',
      ],
    },
    {
      id: 'journal-local-todo-clones',
      label: 'Journal-local TODO clones with backlinks',
      strengths: [
        'Most familiar journal checklist interaction',
        'Works well for list-first mobile flows',
      ],
      weaknesses: [
        'Highest duplication and conflict risk',
        'Requires bidirectional source update behavior that is not complete today',
      ],
    },
  ] satisfies JournalTaskSourceModelEvaluation[],
});

const isCompleted = (task: OutstandingTaskCandidate) =>
  task.checked || task.statusSemantic === 'done';

export const resolveOutstandingTasks = (
  candidates: OutstandingTaskCandidate[]
) => {
  const duplicateIdentities = new Set(findDuplicateTaskIdentities(candidates));
  const tasks: OutstandingTask[] = [];
  const excluded: ExcludedOutstandingTask[] = [];

  for (const candidate of candidates) {
    if (duplicateIdentities.has(candidate.taskIdentity)) {
      excluded.push({ task: candidate, reason: 'duplicate-task-identity' });
      continue;
    }
    if (isCompleted(candidate)) {
      excluded.push({ task: candidate, reason: 'completed' });
      continue;
    }
    const title = candidate.title?.trim();
    if (!title) {
      excluded.push({ task: candidate, reason: 'missing-title' });
      continue;
    }
    tasks.push({ ...candidate, title });
  }

  return { tasks, excluded };
};

export type CarryForwardReference = {
  pageId: string;
  params: {
    blockIds?: string[];
    databaseId?: string;
    databaseRowId?: string;
  };
};

export type CarryForwardEntry = {
  taskIdentity: string;
  title: string;
  sourceType: JournalTaskSourceType;
  context: string[];
  reference: CarryForwardReference;
};

export type CarryForwardPlan = {
  heading: 'Outstanding Tasks';
  entries: CarryForwardEntry[];
};

const buildReference = (task: OutstandingTask): CarryForwardReference => {
  if (task.sourceType === 'database' && task.databaseId && task.databaseRowId) {
    return {
      pageId: task.docId,
      params: {
        databaseId: task.databaseId,
        databaseRowId: task.databaseRowId,
      },
    };
  }
  return {
    pageId: task.docId,
    params: {
      blockIds: [task.blockId],
    },
  };
};

const buildContext = (task: OutstandingTask) =>
  [
    task.epicTitle ? `Epic: ${task.epicTitle}` : undefined,
    task.parentTitle ? `Parent: ${task.parentTitle}` : undefined,
  ].filter((value): value is string => !!value);

export const buildCarryForwardPlan = (
  tasks: OutstandingTask[]
): CarryForwardPlan => ({
  heading: 'Outstanding Tasks',
  entries: tasks.map(task => ({
    taskIdentity: task.taskIdentity,
    title: task.title,
    sourceType: task.sourceType,
    context: buildContext(task),
    reference: buildReference(task),
  })),
});
