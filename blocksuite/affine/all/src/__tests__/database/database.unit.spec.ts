import {
  addProperty,
  copyCellsByProperty,
  createTaskWorkflowStatusOptions,
  DatabaseBlockDataSource,
  databaseBlockProperties,
  deleteColumn,
  getCell,
  getProperty,
  updateCell,
} from '@blocksuite/affine-block-database';
import {
  type CellDataType,
  type ColumnDataType,
  type DatabaseBlockModel,
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { TaskWorkflowDefaultsSchema } from '@blocksuite/affine-shared/services';
import {
  createTaskIdentity,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';
import { propertyModelPresets } from '@blocksuite/data-view/property-pure-presets';
import type { BlockModel, Store } from '@blocksuite/store';
import { Text } from '@blocksuite/store';
import {
  createAutoIncrementIdGenerator,
  TestWorkspace,
} from '@blocksuite/store/test';
import { beforeEach, describe, expect, test } from 'vitest';

const extensions = [
  RootBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  DatabaseBlockSchemaExtension,
];

function createTestOptions() {
  const idGenerator = createAutoIncrementIdGenerator();
  return { id: 'test-collection', idGenerator };
}

function createTestDoc(docId = 'doc0') {
  const options = createTestOptions();
  const collection = new TestWorkspace(options);
  collection.meta.initialize();
  const doc = collection.createDoc(docId);
  doc.load();
  return doc.getStore({ extensions });
}

describe('DatabaseManager', () => {
  let doc: Store;
  let db: DatabaseBlockModel;

  let rootId: BlockModel['id'];
  let noteBlockId: BlockModel['id'];
  let databaseBlockId: BlockModel['id'];
  let p1: BlockModel['id'];
  let p2: BlockModel['id'];
  let col1: ColumnDataType['id'];
  let col2: ColumnDataType['id'];
  let col3: ColumnDataType['id'];

  const selection = [
    { id: '1', value: 'Done', color: 'var(--affine-tag-white)' },
    { id: '2', value: 'TODO', color: 'var(--affine-tag-pink)' },
    { id: '3', value: 'WIP', color: 'var(--affine-tag-blue)' },
  ];

  beforeEach(() => {
    doc = createTestDoc();

    rootId = doc.addBlock('affine:page', {
      title: new Text('database test'),
    });
    noteBlockId = doc.addBlock('affine:note', {}, rootId);

    databaseBlockId = doc.addBlock(
      'affine:database',
      {
        columns: [],
        titleColumn: 'Title',
      },
      noteBlockId
    );

    const databaseModel = doc.getModelById(
      databaseBlockId
    ) as DatabaseBlockModel;
    db = databaseModel;

    col1 = addProperty(
      db,
      'end',
      databaseBlockProperties.numberColumnConfig.create('Number')
    );
    col2 = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Single Select', {
        options: selection,
      })
    );
    col3 = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create('Rich Text')
    );

    doc.updateBlock(databaseModel, {
      columns: [col1, col2, col3],
    });

    p1 = doc.addBlock(
      'affine:paragraph',
      {
        text: new Text('text1'),
      },
      databaseBlockId
    );
    p2 = doc.addBlock(
      'affine:paragraph',
      {
        text: new Text('text2'),
      },
      databaseBlockId
    );

    updateCell(db, p1, {
      columnId: col1,
      value: 0.1,
    });
    updateCell(db, p2, {
      columnId: col2,
      value: [selection[1]],
    });
  });

  test('getColumn', () => {
    const column = {
      ...databaseBlockProperties.numberColumnConfig.create('testColumnId'),
      id: 'testColumnId',
    };
    addProperty(db, 'end', column);

    const result = getProperty(db, column.id);
    expect(result).toEqual(column);
  });

  test('addColumn', () => {
    const column =
      databaseBlockProperties.numberColumnConfig.create('Test Column');
    const id = addProperty(db, 'end', column);
    const result = getProperty(db, id);

    expect(result).toMatchObject(column);
    expect(result).toHaveProperty('id');
  });

  test('deleteColumn', () => {
    const column = {
      ...databaseBlockProperties.numberColumnConfig.create('Test Column'),
      id: 'testColumnId',
    };
    addProperty(db, 'end', column);
    expect(getProperty(db, column.id)).toEqual(column);

    deleteColumn(db, column.id);
    expect(getProperty(db, column.id)).toBeUndefined();
  });

  test('getCell', () => {
    const modelId = doc.addBlock(
      'affine:paragraph',
      {
        text: new Text('paragraph'),
      },
      noteBlockId
    );
    const column = {
      ...databaseBlockProperties.numberColumnConfig.create('Test Column'),
      id: 'testColumnId',
    };
    const cell: CellDataType = {
      columnId: column.id,
      value: 42,
    };

    addProperty(db, 'end', column);
    updateCell(db, modelId, cell);

    const model = doc.getModelById(modelId);

    expect(model).not.toBeNull();

    const result = getCell(db, model!.id, column.id);
    expect(result).toEqual(cell);
  });

  test('updateCell', () => {
    const newRowId = doc.addBlock(
      'affine:paragraph',
      {
        text: new Text('text3'),
      },
      databaseBlockId
    );

    updateCell(db, newRowId, {
      columnId: col2,
      value: [selection[2]],
    });

    const cell = getCell(db, newRowId, col2);
    expect(cell).toEqual({
      columnId: col2,
      value: [selection[2]],
    });
  });

  test('copyCellsByColumn', () => {
    const newColId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Copied Select', {
        options: selection,
      })
    );

    copyCellsByProperty(db, col2, newColId);

    const cell = getCell(db, p2, newColId);
    expect(cell).toEqual({
      columnId: newColId,
      value: [selection[1]],
    });
  });

  test('uses database-level task status inheritance defaults', () => {
    const dataSource = new DatabaseBlockDataSource(db);
    expect(dataSource.getTaskStatusInheritance()).toEqual({
      done: 'require-all-subtasks-complete',
      inProgress: 'start-when-any-subtask-starts',
      autoDemoteAutoDone: true,
      cascadeManualDoneToDescendants: true,
    });
    dataSource.setTaskStatusInheritance({ done: 'disabled' });
    expect(dataSource.getTaskStatusInheritance()).toEqual({
      done: 'disabled',
      inProgress: 'start-when-any-subtask-starts',
      autoDemoteAutoDone: true,
      cascadeManualDoneToDescendants: true,
    });
  });

  test('uses stable global task workflow defaults schema', () => {
    expect(TaskWorkflowDefaultsSchema.parse({})).toEqual({
      list: {
        fieldDefs: [],
        fieldLayout: 'inline',
        statusMapping: {
          statusColumnName: 'Status',
          doneTagLabel: 'Done',
        },
      },
      database: {
        taskStatusInheritance: {
          done: 'require-all-subtasks-complete',
          inProgress: 'start-when-any-subtask-starts',
          autoDemoteAutoDone: true,
          cascadeManualDoneToDescendants: true,
        },
        kanbanColumns: ['Todo:todo', 'In Progress:in_progress', 'Done:done'],
      },
    });
  });

  test('creates status options for every configured kanban column', () => {
    const defaults = TaskWorkflowDefaultsSchema.parse({
      database: {
        kanbanColumns: [
          'Todo:todo',
          'In Progress:in_progress',
          'Review:in_progress',
          'Done:done',
          'Not Doing:none',
        ],
      },
      list: {
        statusMapping: {
          doneTagLabel: 'Done',
        },
      },
    });

    expect(createTaskWorkflowStatusOptions(defaults, 'Done')).toEqual([
      {
        id: 'todo',
        value: 'Todo',
        color: 'var(--affine-tag-yellow)',
        semantic: 'todo',
      },
      {
        id: 'in_progress',
        value: 'In Progress',
        color: 'var(--affine-tag-blue)',
        semantic: 'in_progress',
      },
      {
        id: 'workflow_review',
        value: 'Review',
        color: 'var(--affine-tag-blue)',
        semantic: 'in_progress',
      },
      {
        id: 'done',
        value: 'Done',
        color: 'var(--affine-tag-green)',
        semantic: 'done',
      },
      {
        id: 'workflow_not_doing',
        value: 'Not Doing',
        color: 'var(--affine-tag-yellow)',
        semantic: 'none',
      },
    ]);

    expect(
      createTaskWorkflowStatusOptions(defaults, 'Finished').at(-1)
    ).toEqual({
      id: 'workflow_not_doing',
      value: 'Not Doing',
      color: 'var(--affine-tag-yellow)',
      semantic: 'none',
    });
    expect(
      createTaskWorkflowStatusOptions(defaults, 'Finished')
    ).toContainEqual({
      id: 'done',
      value: 'Finished',
      color: 'var(--affine-tag-green)',
      semantic: 'done',
    });
  });

  test('recomputes parent status from children in status select column', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parentRow = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const childA = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child-a') },
      databaseBlockId
    );
    const childB = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child-b') },
      databaseBlockId
    );

    const parentIdentity = createTaskIdentity({
      docId: doc.id,
      blockId: parentRow,
    });
    updateCell(db, childA, {
      columnId: parentIdentityColumnId,
      value: new Text(parentIdentity),
    });
    updateCell(db, childB, {
      columnId: parentIdentityColumnId,
      value: new Text(parentIdentity),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(childA, statusColumnId, selection[2]?.id);
    expect(getCell(db, parentRow, statusColumnId)?.value).toEqual(
      selection[2]?.id
    );

    dataSource.cellValueChange(childA, statusColumnId, selection[0]?.id);
    dataSource.cellValueChange(childB, statusColumnId, selection[0]?.id);
    expect(getCell(db, parentRow, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );
  });

  test('recomputes parent status for custom status column name and done label', () => {
    const customOptions = [
      { id: 'todo', value: 'Open', color: 'var(--affine-tag-yellow)' },
      { id: 'done', value: 'Finished', color: 'var(--affine-tag-green)' },
    ];
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('State', {
        options: customOptions,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(child, statusColumnId, 'done');
    expect(getCell(db, parent, statusColumnId)?.value).toEqual('done');
  });

  test('treats custom not-done option as todo for parent status recompute', () => {
    const customOptions = [
      { id: 'not_done', value: 'Open', color: 'var(--affine-tag-yellow)' },
      { id: 'done', value: 'Finished', color: 'var(--affine-tag-green)' },
    ];
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: customOptions,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );
    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(child, statusColumnId, 'not_done');

    expect(getCell(db, parent, statusColumnId)?.value).toEqual('not_done');
  });

  test('does not recompute parent status when inheritance is disabled', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );
    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.setTaskStatusInheritance({
      done: 'disabled',
      inProgress: 'disabled',
    });
    dataSource.cellValueChange(child, statusColumnId, selection[0]?.id);

    expect(getCell(db, parent, statusColumnId)?.value).toBeUndefined();
  });

  test('recomputes existing parent statuses when inheritance settings change', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );
    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.setTaskStatusInheritance({
      done: 'disabled',
      inProgress: 'disabled',
    });
    dataSource.cellValueChange(child, statusColumnId, selection[0]?.id);
    expect(getCell(db, parent, statusColumnId)?.value).toBeUndefined();

    dataSource.setTaskStatusInheritance({
      done: 'require-all-subtasks-complete',
    });

    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );
  });

  test('manual parent done cascades to descendants by default and can be disabled', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    const grandchild = doc.addBlock(
      'affine:paragraph',
      { text: new Text('grandchild') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });
    updateCell(db, grandchild, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: child })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(parent, statusColumnId, selection[0]?.id);
    expect(getCell(db, child, statusColumnId)?.value).toEqual(selection[0]?.id);
    expect(getCell(db, grandchild, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );

    dataSource.cellValueChange(parent, statusColumnId, selection[1]?.id);
    dataSource.setTaskStatusInheritance({
      cascadeManualDoneToDescendants: false,
    });
    dataSource.cellValueChange(parent, statusColumnId, selection[0]?.id);
    expect(getCell(db, child, statusColumnId)?.value).toEqual(selection[1]?.id);
    expect(getCell(db, grandchild, statusColumnId)?.value).toEqual(
      selection[1]?.id
    );
  });

  test('parent todo cascade preserves manually locked done descendants', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    const grandchild = doc.addBlock(
      'affine:paragraph',
      { text: new Text('grandchild') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });
    updateCell(db, grandchild, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: child })),
    });
    updateCell(db, grandchild, {
      columnId: statusColumnId,
      value: selection[0]?.id,
    });
    db.props.taskStatusState = {
      [grandchild]: {
        provenance: 'manual',
        manualLock: 'done_locked',
      },
    };

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(parent, statusColumnId, selection[1]?.id);

    expect(getCell(db, child, statusColumnId)?.value).toEqual(selection[1]?.id);
    expect(getCell(db, grandchild, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );
  });

  test('promotes ancestors from descendant done and cascades todo without overwriting manual done descendants', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('p') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('c') },
      databaseBlockId
    );
    const grandchild = doc.addBlock(
      'affine:paragraph',
      { text: new Text('g') },
      databaseBlockId
    );

    const parentIdentity = createTaskIdentity({
      docId: doc.id,
      blockId: parent,
    });
    const childIdentity = createTaskIdentity({ docId: doc.id, blockId: child });
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(parentIdentity),
    });
    updateCell(db, grandchild, {
      columnId: parentIdentityColumnId,
      value: new Text(childIdentity),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(grandchild, statusColumnId, selection[0]?.id);
    expect(getCell(db, child, statusColumnId)?.value).toEqual(selection[0]?.id);
    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );

    dataSource.cellValueChange(parent, statusColumnId, selection[1]?.id);
    expect(getCell(db, child, statusColumnId)?.value).toEqual(selection[1]?.id);
    expect(getCell(db, grandchild, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );
  });

  test('demotes auto ancestor when any descendant demotes from done', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const root = doc.addBlock(
      'affine:paragraph',
      { text: new Text('r') },
      databaseBlockId
    );
    const mid = doc.addBlock(
      'affine:paragraph',
      { text: new Text('m') },
      databaseBlockId
    );
    const leaf = doc.addBlock(
      'affine:paragraph',
      { text: new Text('l') },
      databaseBlockId
    );

    const rootIdentity = createTaskIdentity({ docId: doc.id, blockId: root });
    const midIdentity = createTaskIdentity({ docId: doc.id, blockId: mid });
    updateCell(db, mid, {
      columnId: parentIdentityColumnId,
      value: new Text(rootIdentity),
    });
    updateCell(db, leaf, {
      columnId: parentIdentityColumnId,
      value: new Text(midIdentity),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(leaf, statusColumnId, selection[0]?.id);

    expect(getCell(db, root, statusColumnId)?.value).toEqual(selection[0]?.id);

    dataSource.cellValueChange(leaf, statusColumnId, selection[2]?.id);
    expect(getCell(db, root, statusColumnId)?.value).toEqual(selection[2]?.id);
  });

  test('demotes all auto done ancestors when a grandchild demotes to in-progress semantic', () => {
    const options = [
      {
        id: 'todo',
        value: 'Todo',
        color: 'var(--affine-tag-yellow)',
        semantic: 'todo' as const,
      },
      {
        id: 'in_progress',
        value: 'In Progress',
        color: 'var(--affine-tag-blue)',
        semantic: 'in_progress' as const,
      },
      {
        id: 'workflow_review',
        value: 'Review',
        color: 'var(--affine-tag-blue)',
        semantic: 'in_progress' as const,
      },
      {
        id: 'done',
        value: 'Done',
        color: 'var(--affine-tag-green)',
        semantic: 'done' as const,
      },
    ];
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const root = doc.addBlock(
      'affine:paragraph',
      { text: new Text('r') },
      databaseBlockId
    );
    const mid = doc.addBlock(
      'affine:paragraph',
      { text: new Text('m') },
      databaseBlockId
    );
    const leaf = doc.addBlock(
      'affine:paragraph',
      { text: new Text('l') },
      databaseBlockId
    );

    updateCell(db, mid, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: root })),
    });
    updateCell(db, leaf, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: mid })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(leaf, statusColumnId, [{ id: 'done' }]);
    expect(getCell(db, mid, statusColumnId)?.value).toEqual('done');
    expect(getCell(db, root, statusColumnId)?.value).toEqual('done');

    dataSource.cellValueChange(leaf, statusColumnId, [
      { id: 'workflow_review' },
    ]);
    expect(getCell(db, mid, statusColumnId)?.value).toEqual('in_progress');
    expect(getCell(db, root, statusColumnId)?.value).toEqual('in_progress');
  });

  test('demotes done ancestors without provenance unless explicitly manually locked', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });
    updateCell(db, parent, {
      columnId: statusColumnId,
      value: selection[0]?.id,
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(child, statusColumnId, selection[2]?.id);

    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[2]?.id
    );
  });

  test('demotes an already-done ancestor after children make it auto-satisfied', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(parent, statusColumnId, selection[0]?.id);
    dataSource.cellValueChange(child, statusColumnId, selection[0]?.id);
    dataSource.cellValueChange(child, statusColumnId, selection[2]?.id);

    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[2]?.id
    );
  });

  test('demotes an auto-done ancestor when a nested branch child demotes', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const root = doc.addBlock(
      'affine:paragraph',
      { text: new Text('root') },
      databaseBlockId
    );
    const branch = doc.addBlock(
      'affine:paragraph',
      { text: new Text('branch') },
      databaseBlockId
    );
    const sibling = doc.addBlock(
      'affine:paragraph',
      { text: new Text('sibling') },
      databaseBlockId
    );
    const leaf = doc.addBlock(
      'affine:paragraph',
      { text: new Text('leaf') },
      databaseBlockId
    );

    updateCell(db, branch, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: root })),
    });
    updateCell(db, sibling, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: root })),
    });
    updateCell(db, leaf, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: branch })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(leaf, statusColumnId, selection[0]?.id);
    dataSource.cellValueChange(sibling, statusColumnId, selection[0]?.id);
    expect(getCell(db, branch, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );
    expect(getCell(db, root, statusColumnId)?.value).toEqual(selection[0]?.id);

    dataSource.cellValueChange(leaf, statusColumnId, selection[2]?.id);

    expect(getCell(db, branch, statusColumnId)?.value).toEqual(
      selection[2]?.id
    );
    expect(getCell(db, root, statusColumnId)?.value).toEqual(selection[2]?.id);
  });

  test('demotes auto ancestors when select values are option objects', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );
    const parent = doc.addBlock(
      'affine:paragraph',
      { text: new Text('parent') },
      databaseBlockId
    );
    const child = doc.addBlock(
      'affine:paragraph',
      { text: new Text('child') },
      databaseBlockId
    );
    updateCell(db, child, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: parent })),
    });

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(child, statusColumnId, selection[0]);
    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[0]?.id
    );

    dataSource.cellValueChange(child, statusColumnId, selection[2]);
    expect(getCell(db, parent, statusColumnId)?.value).toEqual(
      selection[2]?.id
    );
  });

  test('demotes A while preserving manually done intermediates in A>B>C>D', () => {
    const statusColumnId = addProperty(
      db,
      'end',
      propertyModelPresets.selectPropertyModelConfig.create('Status', {
        options: selection,
      })
    );
    const parentIdentityColumnId = addProperty(
      db,
      'end',
      databaseBlockProperties.richTextColumnConfig.create(
        TASK_PARENT_IDENTIFIER_COLUMN_NAME
      )
    );

    const a = doc.addBlock(
      'affine:paragraph',
      { text: new Text('A') },
      databaseBlockId
    );
    const b = doc.addBlock(
      'affine:paragraph',
      { text: new Text('B') },
      databaseBlockId
    );
    const c = doc.addBlock(
      'affine:paragraph',
      { text: new Text('C') },
      databaseBlockId
    );
    const d = doc.addBlock(
      'affine:paragraph',
      { text: new Text('D') },
      databaseBlockId
    );

    updateCell(db, b, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: a })),
    });
    updateCell(db, c, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: b })),
    });
    updateCell(db, d, {
      columnId: parentIdentityColumnId,
      value: new Text(createTaskIdentity({ docId: doc.id, blockId: c })),
    });
    updateCell(db, c, { columnId: statusColumnId, value: selection[0]?.id });
    updateCell(db, d, { columnId: statusColumnId, value: selection[0]?.id });
    db.props.taskStatusState = {
      [c]: { provenance: 'manual', manualLock: 'done_locked' },
      [d]: { provenance: 'manual', manualLock: 'done_locked' },
    };

    const dataSource = new DatabaseBlockDataSource(db);
    dataSource.cellValueChange(b, statusColumnId, selection[0]?.id);
    expect(getCell(db, a, statusColumnId)?.value).toEqual(selection[0]?.id);

    dataSource.cellValueChange(d, statusColumnId, selection[2]?.id);
    expect(getCell(db, c, statusColumnId)?.value).toEqual(selection[0]?.id);
    expect(getCell(db, b, statusColumnId)?.value).toEqual(selection[0]?.id);
    expect(getCell(db, a, statusColumnId)?.value).toEqual(selection[2]?.id);
  });
});
