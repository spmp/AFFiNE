import {
  menu,
  type MenuConfig,
} from '@blocksuite/affine-components/context-menu';
import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import { ArrowRightSmallIcon, ViewIcon } from '@blocksuite/icons/lit';
import { computed, signal } from '@preact/signals-core';
import { html } from 'lit';

import { createUniComponentFromWebComponent } from '../../../core/utils/uni-component/uni-component.js';
import { DataViewUILogicBase } from '../../../core/view/data-view-base.js';
import { addRowAfterSameLevel } from '../../shared/add-row-after.js';
import {
  applyHierarchyMutation,
  computeIndentMutation,
  computeUnindentMutation,
} from '../../table/utils.js';
import type { ListSingleView } from '../list-view-manager.js';
import type { ListViewSelectionWithType } from '../selection.js';
import { ListClipboardController } from './controller/clipboard.js';
import { ListDragController } from './controller/drag.js';
import { ListViewRenderer } from './renderer.js';

type TodoListRowDataSource = {
  rowAddAsTodoList?: (position: InsertToPosition | number) => string;
  ensureRowAsTodoList?: (rowId: string) => boolean;
};

const addTodoListRow = (
  view: ListSingleView,
  position: InsertToPosition | number
) => {
  const dataSource = view.manager?.dataSource as
    | TodoListRowDataSource
    | undefined;
  return dataSource?.rowAddAsTodoList?.(position) ?? view.rowAdd(position);
};

export class ListViewUILogic extends DataViewUILogicBase<
  ListSingleView,
  ListViewSelectionWithType
> {
  // Story 2.8: mirrors `TableViewUILogic.ui$` — the rendered
  // `ListViewRenderer` instance, set from its own `connectedCallback`, so
  // `ListDragController` (which needs real DOM to query rows/handles from)
  // has something to anchor to.
  ui$ = signal<ListViewRenderer>();

  dragController = new ListDragController(this);

  clipboardController = new ListClipboardController(this);

  clearSelection = () => {
    this.setSelection();
  };

  /** F-11: the rows selected as whole rows, in view order. */
  selectedRowIds$ = computed(() => {
    const selection = this.selection$.value;
    return selection?.type === 'list' ? selection.rows : [];
  });

  /** Rows in the order shown (rows hidden as overdue are left out). */
  private visibleRowIds() {
    return this.ui$.value?.visibleRowIds() ?? this.view.rowIds$.value;
  }

  selectRows(rowIds: string[], anchor?: string, focus?: string) {
    const selected = new Set(rowIds);
    const rows = this.visibleRowIds().filter(id => selected.has(id));
    if (!rows.length) {
      this.clearSelection();
      return;
    }
    this.setSelection({
      viewId: this.view.id,
      type: 'list',
      rows,
      anchor: anchor ?? rows[0],
      focus: focus ?? rows.at(-1),
    });
  }

  selectRow(rowId: string) {
    this.selectRows([rowId], rowId, rowId);
  }

  /** Selects the rows from the selection's anchor to `rowId` (Shift). */
  extendSelectionTo(rowId: string) {
    const anchor = this.selection$.value?.anchor;
    const order = this.visibleRowIds();
    const from = anchor ? order.indexOf(anchor) : -1;
    const to = order.indexOf(rowId);
    if (from < 0 || to < 0) {
      this.selectRow(rowId);
      return;
    }
    this.selectRows(
      order.slice(Math.min(from, to), Math.max(from, to) + 1),
      anchor,
      rowId
    );
  }

  /** Adds or removes one row (Ctrl/Cmd+click). */
  toggleRowSelected(rowId: string) {
    const rows = this.selectedRowIds$.value;
    if (rows.includes(rowId)) {
      this.selectRows(rows.filter(id => id !== rowId));
    } else {
      this.selectRows([...rows, rowId], rowId, rowId);
    }
  }

  /** Arrow keys with rows selected: move (or with Shift, extend) by one. */
  moveSelection(delta: 1 | -1, extend: boolean) {
    const selection = this.selection$.value;
    const focus = selection?.focus ?? selection?.rows.at(-1);
    if (!focus) return false;
    const order = this.visibleRowIds();
    const target = order[order.indexOf(focus) + delta];
    if (!target) return true;
    if (extend) {
      this.extendSelectionTo(target);
    } else {
      this.selectRow(target);
    }
    return true;
  }

  ensureTodoListRow(rowId: string) {
    const dataSource = this.view.manager?.dataSource as
      | TodoListRowDataSource
      | undefined;
    return dataSource?.ensureRowAsTodoList?.(rowId) ?? false;
  }

  ensureTodoListRows(rowIds: string[]) {
    const dataSource = this.view.manager?.dataSource as
      | TodoListRowDataSource
      | undefined;
    // `.some()` short-circuits on the first row that returns `true` — and
    // `ensureRowAsTodoList` returns `true` both for a row it just converted
    // *and* for a row that's already todo-type (a no-op check) — so with
    // even one pre-existing todo row in the list, every other row (any
    // plain paragraph still needing conversion) was silently skipped every
    // single call. Must process every row, not stop at the first truthy
    // one.
    let changed = false;
    for (const rowId of rowIds) {
      if (dataSource?.ensureRowAsTodoList?.(rowId)) {
        changed = true;
      }
    }
    return changed;
  }

  addRow = (position: InsertToPosition | number) => {
    return addTodoListRow(this.view, position);
  };

  addRowAfter(rowId: string) {
    return addRowAfterSameLevel(this.view, rowId, position =>
      addTodoListRow(this.view, position)
    );
  }

  private applyHierarchyResult(
    result: ReturnType<typeof computeIndentMutation>,
    rowId: string
  ) {
    if (!result) {
      return false;
    }
    const dataSource = this.view.manager.dataSource as {
      doc?: { id: string };
      applyTaskHierarchyMutation?: (
        updatedLevels: Map<string, number>,
        updatedParents: Map<string, string | undefined>,
        updatedAncestors: Map<string, string>
      ) => void;
    };
    if (dataSource.applyTaskHierarchyMutation) {
      dataSource.applyTaskHierarchyMutation(
        result.updatedLevels,
        result.updatedParents,
        result.updatedAncestors
      );
    } else {
      applyHierarchyMutation(
        {
          rowIds: this.view.rowIds$.value,
          rowId,
          docId: dataSource.doc?.id ?? '',
          properties: this.view.propertiesRaw$.value,
        },
        result
      );
    }
    return true;
  }

  indentRow(rowId: string) {
    const dataSource = this.view.manager.dataSource as { doc?: { id: string } };
    return this.applyHierarchyResult(
      computeIndentMutation({
        rowIds: this.view.rowIds$.value,
        rowId,
        docId: dataSource.doc?.id ?? '',
        properties: this.view.propertiesRaw$.value,
      }),
      rowId
    );
  }

  unindentRow(rowId: string) {
    const dataSource = this.view.manager.dataSource as { doc?: { id: string } };
    return this.applyHierarchyResult(
      computeUnindentMutation({
        rowIds: this.view.rowIds$.value,
        rowId,
        docId: dataSource.doc?.id ?? '',
        properties: this.view.propertiesRaw$.value,
      }),
      rowId
    );
  }

  getViewOptionsSettingItems(
    navigateToSubPage: (title: string, getItems: () => MenuConfig[]) => void,
    goBack: () => void
  ): MenuConfig[] {
    const layoutOptions: [string, string][] = [
      ['inline', 'Inline'],
      ['aligned', 'Aligned'],
      ['right', 'Right'],
    ];
    const getLayoutItems = (): MenuConfig[] =>
      layoutOptions.map(([layout, label]) =>
        menu.action({
          name: label,
          closeOnSelect: false,
          postfix:
            this.view.fieldLayout$.value === layout
              ? html`<span>✓</span>`
              : undefined,
          select: () => {
            this.view.setFieldLayout(layout as 'inline' | 'aligned' | 'right');
            goBack();
          },
        })
      );

    return [
      menu.group({
        name: 'List fields',
        items: [
          menu.action({
            name: this.view.showAdditionalFields$.value
              ? 'Hide additional fields'
              : 'Show additional fields',
            prefix: ViewIcon(),
            closeOnSelect: false,
            select: () => {
              this.view.setAdditionalFieldsVisible(
                !this.view.showAdditionalFields$.value
              );
            },
          }),
          menu.action({
            name: 'Field layout',
            prefix: ViewIcon(),
            closeOnSelect: false,
            postfix: html`<div
                style="font-size:14px;color:var(--affine-text-secondary-color);"
              >
                ${this.view.fieldLayout$.value}
              </div>
              ${ArrowRightSmallIcon()}`,
            select: () => {
              navigateToSubPage('Field layout', getLayoutItems);
              return false;
            },
          }),
        ],
      }),
    ];
  }

  focusFirstCell = () => {};

  showIndicator = () => false;

  hideIndicator = () => {};

  moveTo = () => {};

  renderer = createUniComponentFromWebComponent(ListViewRenderer);
}
