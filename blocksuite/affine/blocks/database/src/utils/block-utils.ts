import type {
  CellDataType,
  ColumnDataType,
  ColumnUpdater,
  DatabaseBlockModel,
  ViewBasicDataType,
} from '@blocksuite/affine-model';
import {
  arrayMove,
  insertPositionToIndex,
  type InsertToPosition,
} from '@blocksuite/affine-shared/utils';
import type { BlockModel } from '@blocksuite/store';

export function addProperty(
  model: DatabaseBlockModel,
  position: InsertToPosition,
  column: Omit<ColumnDataType, 'id'> & {
    id?: string;
  }
): string {
  const id = column.id ?? model.store.workspace.idGenerator();
  if (model.props.columns.some(v => v.id === id)) {
    return id;
  }
  model.store.transact(() => {
    const col: ColumnDataType = {
      ...column,
      id,
    };
    model.props.columns.splice(
      insertPositionToIndex(position, model.props.columns),
      0,
      col
    );
  });
  return id;
}

export function copyCellsByProperty(
  model: DatabaseBlockModel,
  fromId: ColumnDataType['id'],
  toId: ColumnDataType['id']
) {
  model.store.transact(() => {
    Object.keys(model.props.cells).forEach(rowId => {
      const cell = model.props.cells[rowId]?.[fromId];
      if (cell && model.props.cells[rowId]) {
        model.props.cells[rowId][toId] = {
          ...cell,
          columnId: toId,
        };
      }
    });
  });
}

export function deleteColumn(
  model: DatabaseBlockModel,
  columnId: ColumnDataType['id']
) {
  const index = model.props.columns.findIndex(v => v.id === columnId);
  if (index < 0) return;

  model.store.transact(() => {
    model.props.columns.splice(index, 1);
  });
}

export function deleteRows(model: DatabaseBlockModel, rowIds: string[]) {
  model.store.transact(() => {
    for (const rowId of rowIds) {
      delete model.props.cells[rowId];
    }
  });
}

export function deleteView(model: DatabaseBlockModel, id: string) {
  model.store.captureSync();
  model.store.transact(() => {
    model.props.views = model.props.views.filter(v => v.id !== id);
  });
}

export function duplicateView(model: DatabaseBlockModel, id: string): string {
  const newId = model.store.workspace.idGenerator();
  model.store.transact(() => {
    const index = model.props.views.findIndex(v => v.id === id);
    const view = model.props.views[index];
    if (view) {
      model.props.views.splice(
        index + 1,
        0,
        JSON.parse(JSON.stringify({ ...view, id: newId }))
      );
    }
  });
  return newId;
}

export function getCell(
  model: DatabaseBlockModel,
  rowId: BlockModel['id'],
  columnId: ColumnDataType['id']
): CellDataType | null {
  if (columnId === 'title') {
    return {
      columnId: 'title',
      value: rowId,
    };
  }
  const yRow = model.props.cells$.value[rowId];
  const yCell = yRow?.[columnId] ?? null;
  if (!yCell) return null;

  return {
    columnId: yCell.columnId,
    value: yCell.value,
  };
}

export function getProperty(
  model: DatabaseBlockModel,
  id: ColumnDataType['id']
): ColumnDataType | undefined {
  return model.props.columns.find(v => v.id === id);
}

export function moveViewTo(
  model: DatabaseBlockModel,
  id: string,
  position: InsertToPosition
) {
  model.store.transact(() => {
    model.props.views = arrayMove(
      model.props.views,
      v => v.id === id,
      arr => insertPositionToIndex(position, arr)
    );
  });
}

export function updateCell(
  model: DatabaseBlockModel,
  rowId: string,
  cell: CellDataType
) {
  model.store.transact(() => {
    const columnId = cell.columnId;
    if (
      rowId === '__proto__' ||
      rowId === 'constructor' ||
      rowId === 'prototype'
    ) {
      console.error('Invalid rowId');
      return;
    }
    if (
      columnId === '__proto__' ||
      columnId === 'constructor' ||
      columnId === 'prototype'
    ) {
      console.error('Invalid columnId');
      return;
    }
    // Reassign the whole `cells` prop rather than mutating a nested
    // `cells[rowId][columnId]` in place. `cells` is one plain-object model
    // prop (`SerializedCells`), and its reactive `cells$` signal (read by
    // `getCell`, and transitively by every cell-rendering Lit component via
    // `SignalWatcher`) is only invalidated by a top-level reassignment —
    // an in-place nested bracket write physically persists (confirmed via
    // direct read-back) but never notifies anything watching `cells$`, so
    // a just-written cell (e.g. a task checkbox toggle) silently fails to
    // re-render until something unrelated forces a fresh render pass.
    model.props.cells = {
      ...model.props.cells,
      [rowId]: {
        ...model.props.cells[rowId],
        [columnId]: {
          columnId,
          value: cell.value,
        },
      },
    };
  });
}

export function updateCells(
  model: DatabaseBlockModel,
  columnId: string,
  cells: Record<string, unknown>
) {
  model.store.transact(() => {
    const nextCells = { ...model.props.cells };
    Object.entries(cells).forEach(([rowId, value]) => {
      if (
        rowId === '__proto__' ||
        rowId === 'constructor' ||
        rowId === 'prototype'
      ) {
        throw new Error('Invalid rowId');
      }
      nextCells[rowId] = {
        ...nextCells[rowId],
        [columnId]: {
          columnId,
          value,
        },
      };
    });
    // Same reasoning as `updateCell` — reassign the top-level `cells` prop
    // once, rather than nested in-place bracket writes per row, so the
    // `cells$` signal actually invalidates.
    model.props.cells = nextCells;
  });
}

export function updateProperty(
  model: DatabaseBlockModel,
  id: string,
  updater: ColumnUpdater,
  defaultValue?: Record<string, unknown>
) {
  const index = model.props.columns.findIndex(v => v.id === id);
  if (index == null) {
    return;
  }
  model.store.transact(() => {
    const column = model.props.columns[index];
    if (!column) {
      return;
    }
    const result = updater(column);
    model.props.columns[index] = { ...defaultValue, ...column, ...result };
  });
  return id;
}

export const updateView = <ViewData extends ViewBasicDataType>(
  model: DatabaseBlockModel,
  id: string,
  update: (data: ViewData) => Partial<ViewData>
) => {
  model.store.transact(() => {
    model.props.views = model.props.views.map(v => {
      if (v.id !== id) {
        return v;
      }
      return { ...v, ...update(v as ViewData) };
    });
  });
};
export const DATABASE_CONVERT_WHITE_LIST = ['affine:list', 'affine:paragraph'];
