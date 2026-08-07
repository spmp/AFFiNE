import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import {
  BaseCellRenderer,
  createFromBaseCellRenderer,
  createIcon,
} from '@blocksuite/data-view';
import { PageIcon, PlusIcon } from '@blocksuite/icons/lit';
import { html } from 'lit';

import { EditorHostKey } from '../../context/host-context.js';
import type { DatabaseBlockDataSource } from '../../data-source.js';
import {
  attachExistingNoteForRow,
  createNoteForRow,
  revealOrInsertNoteForRow,
} from './actions.js';
import { notePropertyModelConfig, type NoteRefValue } from './define.js';

const CELL_STYLE =
  'display: flex; align-items: center; justify-content: center; cursor: pointer;';

export class NoteCell extends BaseCellRenderer<NoteRefValue, NoteRefValue> {
  get std() {
    const host = this.view.serviceGet(EditorHostKey);
    return host?.std;
  }

  get dataSource() {
    return this.view.manager.dataSource as unknown as DatabaseBlockDataSource;
  }

  get rowId() {
    return this.cell.rowId;
  }

  private readonly _openCreateOrAttachMenu = (e: MouseEvent) => {
    e.stopPropagation();
    const std = this.std;
    if (!std) return;
    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options: {
        items: [
          menu.action({
            name: 'New note',
            prefix: PageIcon(),
            select: () => {
              createNoteForRow(std, this.dataSource, this.rowId);
            },
          }),
          menu.action({
            name: 'Link existing note',
            prefix: PageIcon(),
            select: () => {
              attachExistingNoteForRow(std, this.dataSource, this.rowId).catch(
                console.error
              );
            },
          }),
        ],
      },
    });
  };

  private readonly _revealOrInsert = (e: MouseEvent) => {
    e.stopPropagation();
    const std = this.std;
    if (!std) return;
    revealOrInsertNoteForRow(std, this.dataSource, this.rowId);
  };

  override render() {
    if (!this.value) {
      return html`
        <div
          data-testid="note-cell-create"
          style="${CELL_STYLE}"
          @click="${this._openCreateOrAttachMenu}"
        >
          ${PlusIcon()}
        </div>
      `;
    }

    const color = this.dataSource.getNoteColor(this.rowId);
    return html`
      <div
        data-testid="note-cell-open"
        style="${CELL_STYLE}${color ? ` color: ${color};` : ''}"
        @click="${this._revealOrInsert}"
      >
        ${PageIcon()}
      </div>
    `;
  }
}

export const noteColumnConfig = notePropertyModelConfig.createPropertyMeta({
  icon: createIcon('LinkIcon'),
  cellRenderer: {
    view: createFromBaseCellRenderer(NoteCell),
  },
});
