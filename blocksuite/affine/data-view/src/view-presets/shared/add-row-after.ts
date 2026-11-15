import {
  type InsertToPosition,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';

import type { SingleView } from '../../core/view-manager/single-view.js';
import { normalizeHierarchyLevel } from '../table/utils.js';

/**
 * Adds a row after `rowId` and its subtree (rows indented under it), at
 * `rowId`'s own indent level and under the same parent, as Enter does in a
 * List view. `addRow` creates the row (a to-do row in the List view, a plain
 * row in a table). Returns the new row's id.
 */
export function addRowAfterSameLevel(
  view: SingleView,
  rowId: string,
  addRow: (position: InsertToPosition | number) => string
): string {
  const levelProperty = view.propertiesRaw$.value.find(
    property => property.name$.value === TASK_HIERARCHY_LEVEL_COLUMN_NAME
  );
  const rowIds = view.rowIds$.value;
  const rowIndex = rowIds.indexOf(rowId);
  const rowLevel = levelProperty
    ? normalizeHierarchyLevel(
        levelProperty.cellGetOrCreate(rowId).jsonValue$.value
      )
    : 0;
  let insertIndex = rowIndex + 1;
  if (levelProperty && rowIndex >= 0) {
    while (insertIndex < rowIds.length) {
      const nextRowId = rowIds[insertIndex];
      if (!nextRowId) {
        break;
      }
      const nextLevel = normalizeHierarchyLevel(
        levelProperty.cellGetOrCreate(nextRowId).jsonValue$.value
      );
      if (nextLevel <= rowLevel) {
        break;
      }
      insertIndex += 1;
    }
  }
  const insertPosition: InsertToPosition | number =
    insertIndex >= rowIds.length
      ? 'end'
      : { before: true, id: rowIds[insertIndex] as string };
  const newRowId = addRow(insertPosition);
  const getColumnStringValue = (columnName: string) => {
    const property = view.propertiesRaw$.value.find(
      property => property.name$.value === columnName
    );
    return property?.stringValueGet(rowId) ?? '';
  };
  const parent = getColumnStringValue(TASK_PARENT_IDENTIFIER_COLUMN_NAME);
  const ancestors = getColumnStringValue(TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME);
  const dataSource = view.manager?.dataSource as
    | {
        applyTaskHierarchyMutation?: (
          updatedLevels: Map<string, number>,
          updatedParents: Map<string, string | undefined>,
          updatedAncestors: Map<string, string>
        ) => void;
      }
    | undefined;
  if (dataSource?.applyTaskHierarchyMutation) {
    dataSource.applyTaskHierarchyMutation(
      new Map([[newRowId, rowLevel]]),
      new Map([[newRowId, parent || undefined]]),
      new Map([[newRowId, ancestors]])
    );
    return newRowId;
  }
  const copyColumnValue = (columnName: string) => {
    const property = view.propertiesRaw$.value.find(
      property => property.name$.value === columnName
    );
    if (!property) {
      return;
    }
    property.valueSetFromString(newRowId, property.stringValueGet(rowId) ?? '');
  };
  copyColumnValue(TASK_HIERARCHY_LEVEL_COLUMN_NAME);
  copyColumnValue(TASK_PARENT_IDENTIFIER_COLUMN_NAME);
  copyColumnValue(TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME);
  return newRowId;
}
