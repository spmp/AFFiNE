import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { customElement, eventOptions, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { renderUniLit } from '../../../core/utils/uni-component/index.js';
import type { ListViewUILogic } from './list-view-ui-logic.js';

const HIERARCHY_LEVEL_COLUMN_NAME = 'Hierarchy Level';

@customElement('affine-data-view-list')
export class ListViewRenderer extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  private readonly cellEditing$ = signal(true);

  private focusRowTitle(rowId: string) {
    const focus = (attempt = 0) => {
      const row = this.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);
      const titleCell = row?.querySelector<HTMLElement>(
        'data-view-header-area-text'
      ) as (HTMLElement & { inlineEditor?: { focusEnd?: () => void } }) | null;
      const richText = row?.querySelector<HTMLElement>('rich-text');
      row?.focus();
      titleCell?.inlineEditor?.focusEnd?.();
      if (!titleCell?.inlineEditor && richText) {
        richText.focus();
      }
      if (!titleCell?.inlineEditor && attempt < 5) {
        requestAnimationFrame(() => focus(attempt + 1));
      }
    };
    requestAnimationFrame(() => focus());
  }

  static override styles = css`
    .affine-data-view-list {
      display: flex;
      flex-direction: column;
      padding: 2px 0;
    }

    .affine-data-view-list-row {
      display: flex;
      align-items: center;
      min-height: 28px;
      padding: 1px 8px;
      box-sizing: border-box;
    }

    .affine-data-view-list-title {
      flex: 1;
      min-width: 0;
    }

    .affine-data-view-list-fields {
      display: inline-flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 6px;
      margin-left: 0;
      min-width: 0;
    }

    .affine-data-view-list-fields[data-layout='inline'] {
      margin-left: 2px;
      margin-right: 0;
      justify-content: flex-start;
    }

    .affine-data-view-list-fields[data-layout='aligned'] {
      margin-left: auto;
      width: min(40vw, 360px);
      justify-content: flex-end;
      display: grid;
      grid-template-columns: repeat(
        var(--affine-list-field-count),
        minmax(108px, 1fr)
      );
      gap: 8px;
    }

    .affine-data-view-list-fields[data-layout='right'] {
      margin-left: auto;
      justify-content: flex-end;
      width: min(40vw, 360px);
      display: grid;
      grid-template-columns: repeat(
        var(--affine-list-field-count),
        minmax(108px, 1fr)
      );
      gap: 8px;
    }

    .affine-data-view-list-field {
      border: 1px solid var(--affine-border-color);
      border-radius: 6px;
      font-size: 12px;
      line-height: 20px;
      padding: 0 8px;
      margin: 1px 0 0 8px;
      width: auto;
      min-width: 72px;
      max-width: 100%;
      text-align: left;
      flex: 0 1 auto;
      background: transparent;
      color: var(--affine-text-primary-color);
      outline: none;
      box-sizing: border-box;
    }

    .affine-data-view-list-field-number {
      text-align: right;
    }

    .affine-data-view-list-fields[data-layout='aligned']
      .affine-data-view-list-field,
    .affine-data-view-list-fields[data-layout='right']
      .affine-data-view-list-field {
      width: 100%;
      min-width: 0;
      max-width: none;
      margin-left: 0;
    }

    .affine-data-view-list-fields[data-layout='right']
      .affine-data-view-list-field {
      justify-self: end;
    }

    .affine-data-view-list-row:focus-within {
      background: var(--affine-hover-color);
      border-radius: 6px;
    }
  `;

  @property({ attribute: false })
  accessor logic!: ListViewUILogic;

  private get view() {
    return this.logic.view;
  }

  private getHierarchyLevel(rowId: string) {
    const property = this.view.propertiesRaw$.value.find(
      property => property.name$.value === HIERARCHY_LEVEL_COLUMN_NAME
    );
    const value = property
      ? this.view.cellGetOrCreate(rowId, property.id).value$.value
      : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    }
    return 0;
  }

  private renderCell(rowId: string, propertyId: string) {
    const property = this.view.propertyGetOrCreate(propertyId);
    const renderer = property.meta$.value?.renderer.cellRenderer.view;
    if (!renderer) {
      return nothing;
    }
    const cell = this.view.cellGetOrCreate(rowId, propertyId);
    return renderUniLit(renderer, {
      cell,
      isEditing$: this.cellEditing$,
      selectCurrentCell: () => {},
    });
  }

  private renderDetailValue(rowId: string, propertyId: string) {
    const property = this.view.propertyGetOrCreate(propertyId);
    const cell = this.view.cellGetOrCreate(rowId, propertyId);
    const value = cell.stringValue$.value ?? '';
    const propertyType = property.type$.value;
    const commitOnBlur =
      propertyType === 'select' || propertyType === 'multi-select';
    const commit = (target: HTMLInputElement) => {
      property.valueSetFromString(rowId, target.value.trim());
    };
    const onInput = (event: InputEvent) => {
      if (commitOnBlur) {
        return;
      }
      const target = event.target as HTMLInputElement;
      commit(target);
    };
    const onBlur = (event: FocusEvent) => {
      if (!commitOnBlur) {
        return;
      }
      commit(event.target as HTMLInputElement);
    };
    const stop = (event: Event) => event.stopPropagation();
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter' && commitOnBlur) {
        (event.target as HTMLInputElement).blur();
      }
    };
    return html`<input
      class=${propertyType === 'number'
        ? 'affine-data-view-list-field affine-data-view-list-field-number'
        : 'affine-data-view-list-field'}
      .value=${value}
      placeholder=${property.name$.value}
      inputmode=${propertyType === 'number' ? 'decimal' : 'text'}
      @input=${onInput}
      @blur=${onBlur}
      @change=${onBlur}
      @keydown=${onKeyDown}
      @mousedown=${stop}
      @click=${stop}
    />`;
  }

  @eventOptions({ capture: true })
  private onRowKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
      return;
    }
    const rowId = (event.currentTarget as HTMLElement | null)?.dataset.rowId;
    if (!rowId) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      const newRowId = this.logic.addRowAfter(rowId);
      this.focusRowTitle(newRowId);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.shiftKey) {
        this.logic.unindentRow(rowId);
      } else {
        this.logic.indentRow(rowId);
      }
      this.requestUpdate();
    }
  }

  override render() {
    if (!this.logic) {
      return nothing;
    }
    const titleColumn = this.view.mainProperties$.value.titleColumn;
    const detailProperties = this.view.detailProperties$.value.filter(
      property => property.id !== titleColumn
    );
    const fieldLayout = this.view.fieldLayout$.value;
    return html`${this.logic.headerWidget
        ? renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })
        : nothing}
      <div class="affine-data-view-list">
        ${repeat(
          this.view.rows$.value,
          row => row.rowId,
          row => {
            const indent = this.getHierarchyLevel(row.rowId) * 24;
            return html`<div
              class="affine-data-view-list-row"
              data-row-id=${row.rowId}
              tabindex="0"
              style="padding-left: ${8 + indent}px"
              @keydown=${this.onRowKeyDown}
            >
              <div class="affine-data-view-list-title">
                ${titleColumn
                  ? this.renderCell(row.rowId, titleColumn)
                  : nothing}
              </div>
              ${detailProperties.length
                ? html`<div
                    class="affine-data-view-list-fields"
                    data-layout=${fieldLayout}
                    style="--affine-list-field-count: ${Math.max(
                      detailProperties.length,
                      1
                    )}"
                  >
                    ${detailProperties.map(property =>
                      this.renderDetailValue(row.rowId, property.id)
                    )}
                  </div>`
                : nothing}
            </div>`;
          }
        )}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-data-view-list': ListViewRenderer;
  }
}
