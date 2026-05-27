export type TaskIdentityInput = {
  docId: string;
  blockId: string;
  spaceId?: string;
};

export type TaskInteropLink = {
  taskIdentity: string;
  docId: string;
  blockId: string;
  sourceFlavor: string;
  databaseId?: string;
  databaseRowId?: string;
};

export type TaskInteropChangedField = 'title' | 'checked';

export type TaskInteropUpdatedDetail = {
  link: TaskInteropLink;
  changed: TaskInteropChangedField[];
};

export const TASK_INTEROP_UPDATED_EVENT = 'affine:task-interop-updated';

const TASK_ID_SEPARATOR = ':';

const encodePart = (value: string) => encodeURIComponent(value);
const decodePart = (value: string) => decodeURIComponent(value);

export function createTaskIdentity({
  docId,
  blockId,
  spaceId,
}: TaskIdentityInput) {
  const parts = [spaceId, docId, blockId].filter(Boolean).map(encodePart);
  return parts.join(TASK_ID_SEPARATOR);
}

export function parseTaskIdentity(taskIdentity: string) {
  const parts = taskIdentity.split(TASK_ID_SEPARATOR);
  if (parts.length === 2) {
    return {
      spaceId: undefined,
      docId: decodePart(parts[0] ?? ''),
      blockId: decodePart(parts[1] ?? ''),
    };
  }

  if (parts.length === 3) {
    return {
      spaceId: decodePart(parts[0] ?? ''),
      docId: decodePart(parts[1] ?? ''),
      blockId: decodePart(parts[2] ?? ''),
    };
  }

  return null;
}

export function createTodoTaskInteropLink(
  input: TaskIdentityInput & {
    sourceFlavor?: string;
    databaseId?: string;
    databaseRowId?: string;
  }
): TaskInteropLink {
  return {
    taskIdentity: createTaskIdentity(input),
    docId: input.docId,
    blockId: input.blockId,
    sourceFlavor: input.sourceFlavor ?? 'affine:list',
    databaseId: input.databaseId,
    databaseRowId: input.databaseRowId,
  };
}

export function createDatabaseRowTaskInteropLink(
  input: TaskIdentityInput & {
    databaseId: string;
    sourceFlavor?: string;
  }
): TaskInteropLink {
  return {
    taskIdentity: createTaskIdentity(input),
    docId: input.docId,
    blockId: input.blockId,
    sourceFlavor: input.sourceFlavor ?? 'affine:paragraph',
    databaseId: input.databaseId,
    databaseRowId: input.blockId,
  };
}

export function hasSameTaskIdentity(
  left: Pick<TaskInteropLink, 'taskIdentity'>,
  right: Pick<TaskInteropLink, 'taskIdentity'>
) {
  return left.taskIdentity === right.taskIdentity;
}

export function findDuplicateTaskIdentities(links: TaskInteropLink[]) {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.taskIdentity, (counts.get(link.taskIdentity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([taskIdentity]) => taskIdentity);
}
