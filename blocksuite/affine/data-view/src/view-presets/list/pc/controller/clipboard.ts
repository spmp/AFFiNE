import type { ReactiveController } from 'lit';

import {
  copyRowsToClipboard,
  insertClipboardRows,
  readClipboardRows,
} from '../../../shared/rows-clipboard.js';
import type { ListViewUILogic } from '../list-view-ui-logic.js';

/**
 * F-11: copy the selected rows; paste copied rows as new rows after the
 * selected rows, or after the row being typed in (`pasteAfter`).
 */
export class ListClipboardController implements ReactiveController {
  constructor(private readonly logic: ListViewUILogic) {}

  get host() {
    return this.logic.ui$.value;
  }

  /**
   * Pastes copied rows from `data` after `rowId` and selects them. False
   * when the clipboard holds no copied rows (paste text as usual).
   */
  pasteAfter(rowId: string | undefined, data: DataTransfer | null) {
    if (this.logic.view.readonly$.value) return false;
    const rows = readClipboardRows(this.logic, data);
    if (!rows) return false;
    const ids = insertClipboardRows(
      this.logic.view,
      rows,
      rowId,
      this.logic.addRow
    );
    this.logic.selectRows(ids);
    return true;
  }

  hostConnected() {
    this.host?.disposables.add(
      this.logic.handleEvent('copy', () => {
        const rowIds = this.logic.selectedRowIds$.value;
        if (!rowIds.length) return false;
        copyRowsToClipboard(this.logic, rowIds);
        return true;
      })
    );
    this.host?.disposables.add(
      this.logic.handleEvent('paste', ctx => {
        const rowIds = this.logic.selectedRowIds$.value;
        if (!rowIds.length) return false;
        const event = ctx.get('clipboardState').raw;
        if (!this.pasteAfter(rowIds.at(-1), event.clipboardData)) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      })
    );
  }
}
