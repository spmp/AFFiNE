import {
  menu,
  popFilterableSimpleMenu,
  type PopupTarget,
} from '@blocksuite/affine-components/context-menu';
import {
  createTaskIdentity,
  encodeTaskAncestorIdentityToken,
  TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME,
  TASK_HIERARCHY_LEVEL_COLUMN_NAME,
  TASK_PARENT_IDENTIFIER_COLUMN_NAME,
} from '@blocksuite/affine-shared/utils';
import {
  ArrowRightBigIcon,
  DeleteIcon,
  ExpandFullIcon,
  MoveLeftIcon,
  MoveRightIcon,
} from '@blocksuite/icons/lit';
import { html } from 'lit';

import { filterTraitKey } from '../../../core/filter/trait.js';
import type { KanbanSelectionController } from './controller/selection.js';
import type { KanbanViewUILogic } from './kanban-view-ui-logic.js';

export const openDetail = (
  kanbanViewLogic: KanbanViewUILogic,
  rowId: string,
  selection: KanbanSelectionController
) => {
  const old = selection.selection;
  selection.selection = undefined;
  kanbanViewLogic.root.openDetailPanel({
    view: selection.view,
    rowId: rowId,
    onClose: () => {
      selection.selection = old;
    },
  });
};

export const popCardMenu = (
  kanbanViewLogic: KanbanViewUILogic,
  ele: PopupTarget,
  rowId: string,
  selection: KanbanSelectionController
) => {
  const view = selection.view;
  const filterTrait = view.traitGet(filterTraitKey);
  const parentIdentityProperty = view.propertiesRaw$.value.find(
    p => p.name$.value === TASK_PARENT_IDENTIFIER_COLUMN_NAME
  );
  const ancestorIdentitiesProperty = view.propertiesRaw$.value.find(
    p => p.name$.value === TASK_ANCESTOR_IDENTIFIERS_COLUMN_NAME
  );
  const hierarchyLevelProperty = view.propertiesRaw$.value.find(
    p => p.name$.value === TASK_HIERARCHY_LEVEL_COLUMN_NAME
  );
  const taskIdentity = createTaskIdentity({
    docId: view.manager.dataSource.doc.id,
    blockId: rowId,
  });

  const groups = (selection.view.groupTrait.groupsDataList$.value ?? []).filter(
    (v): v is NonNullable<typeof v> => v != null
  );
  popFilterableSimpleMenu(ele, [
    menu.action({
      name: 'Expand Card',
      prefix: ExpandFullIcon(),
      select: () => {
        openDetail(kanbanViewLogic, rowId, selection);
      },
    }),
    menu.subMenu({
      name: 'Move To',
      prefix: ArrowRightBigIcon(),
      options: {
        items:
          groups
            .filter(v => {
              const cardSelection = selection.selection;
              if (cardSelection?.selectionType === 'card') {
                const currentGroup = cardSelection.cards[0]?.groupKey;
                return currentGroup ? v.key !== currentGroup : true;
              }
              return false;
            })
            .map(group =>
              menu.action({
                name: group.value != null ? group.name$.value : 'Ungroup',
                select: () => {
                  selection.moveCard(rowId, group.key);
                },
              })
            ) ?? [],
      },
    }),
    menu.action({
      name: 'Show children',
      select: () => {
        if (!filterTrait || !parentIdentityProperty || !taskIdentity) {
          return;
        }
        const currentFilter = filterTrait.filter$.value;
        const baseConditions = currentFilter.conditions.filter(condition => {
          if (condition.type !== 'filter') {
            return true;
          }
          if (condition.left.type !== 'ref') {
            return true;
          }
          if (
            hierarchyLevelProperty &&
            condition.left.name === hierarchyLevelProperty.id
          ) {
            return false;
          }
          if (condition.left.name === parentIdentityProperty.id) {
            return false;
          }
          if (
            ancestorIdentitiesProperty &&
            condition.left.name === ancestorIdentitiesProperty.id
          ) {
            return false;
          }
          return true;
        });

        filterTrait.filterSet({
          ...currentFilter,
          conditions: [
            ...baseConditions,
            {
              type: 'filter',
              left: {
                type: 'ref',
                name: parentIdentityProperty.id,
              },
              function: 'is',
              args: [{ type: 'literal', value: taskIdentity }],
            },
          ],
        });
      },
    }),
    menu.action({
      name: 'Show descendants',
      select: () => {
        if (!filterTrait || !ancestorIdentitiesProperty || !taskIdentity) {
          return;
        }
        const currentFilter = filterTrait.filter$.value;
        const baseConditions = currentFilter.conditions.filter(condition => {
          if (condition.type !== 'filter') {
            return true;
          }
          if (condition.left.type !== 'ref') {
            return true;
          }
          if (
            hierarchyLevelProperty &&
            condition.left.name === hierarchyLevelProperty.id
          ) {
            return false;
          }
          if (condition.left.name === ancestorIdentitiesProperty.id) {
            return false;
          }
          if (
            parentIdentityProperty &&
            condition.left.name === parentIdentityProperty.id
          ) {
            return false;
          }
          return true;
        });

        filterTrait.filterSet({
          ...currentFilter,
          conditions: [
            ...baseConditions,
            {
              type: 'filter',
              left: {
                type: 'ref',
                name: ancestorIdentitiesProperty.id,
              },
              function: 'contains',
              args: [
                {
                  type: 'literal',
                  value: encodeTaskAncestorIdentityToken(taskIdentity),
                },
              ],
            },
          ],
        });
      },
    }),
    menu.group({
      name: '',
      items: [
        menu.action({
          name: 'Insert Before',
          prefix: html` <div
            style="transform: rotate(90deg);display:flex;align-items:center;"
          >
            ${MoveLeftIcon()}
          </div>`,
          select: () => {
            selection.insertRowBefore();
          },
        }),
        menu.action({
          name: 'Insert After',
          prefix: html` <div
            style="transform: rotate(90deg);display:flex;align-items:center;"
          >
            ${MoveRightIcon()}
          </div>`,
          select: () => {
            selection.insertRowAfter();
          },
        }),
      ],
    }),
    menu.group({
      name: '',
      items: [
        menu.action({
          name: 'Delete Card',
          class: {
            'delete-item': true,
          },
          prefix: DeleteIcon(),
          select: () => {
            selection.deleteCard();
          },
        }),
      ],
    }),
  ]);
};
