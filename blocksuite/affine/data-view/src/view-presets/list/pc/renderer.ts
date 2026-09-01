import { mergeWithPrev } from '@blocksuite/affine-block-paragraph';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { DatePicker } from '@blocksuite/affine-components/date-picker';
import { createLitPortal } from '@blocksuite/affine-components/portal';
import { IS_MOBILE } from '@blocksuite/global/env';
import { SignalWatcher, WithDisposable } from '@blocksuite/global/lit';
import { DateTimeIcon, PageIcon, PlusIcon } from '@blocksuite/icons/lit';
import type { BlockStdScope } from '@blocksuite/std';
import { ShadowlessElement } from '@blocksuite/std';
import { flip, offset } from '@floating-ui/dom';
import { signal } from '@preact/signals-core';
import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, eventOptions, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { EditorHostKey } from '../../../core/context/host-context.js';
import type { TaskWorkflowCapableDataSource } from '../../../core/data-source/task-workflow-capable.js';
import { renderUniLit } from '../../../core/utils/uni-component/index.js';
import type { ListViewUILogic } from './list-view-ui-logic.js';

const HIERARCHY_LEVEL_COLUMN_NAME = 'Hierarchy Level';

// Story 2.12 (MOBILE-03): touch has no `:hover` state, so the three
// hover-gated row-action classes below (note/due-date/drag-handle) are
// otherwise invisible on mobile web. This block reproduces
// `table/mobile/row.ts`'s already-shipped "opposite polarity" default —
// visible by default, hidden only during an editing-equivalent state — but
// inline (`IS_MOBILE`-gated), since List has no separate mobile component
// the way Table/Kanban do. List also has no `data-editing` DOM hook
// (unlike Table/Kanban's `[data-editing='true']`); the closest existing
// hook is the row's own `:focus-within` state (already used above for an
// unrelated background-highlight rule), reused here as the
// editing-equivalent trigger per RESEARCH.md Pattern 2 / Pitfall 4. The
// desktop `:hover` rules below are left completely unmodified (MOBILE-05).
const mobileListActionStyles = css`
  .affine-data-view-list-note-action,
  .affine-data-view-list-due-date-action,
  .affine-data-view-list-drag-handle {
    visibility: visible;
    opacity: 1;
  }

  /* Task 2 (live-verification finding, RESEARCH.md Pitfall 4 / Open
     Question 2): the whole-row \`:focus-within\` above incorrectly treated a
     mere row-select tap (the row itself receiving focus via its own
     \`tabindex="0"\`) as "editing", since \`:focus-within\` matches an
     element that itself holds focus, not only a focused descendant.
     Narrowed to \`:has(.affine-data-view-list-title:focus-within)\` so only
     focus that actually lands inside the title's own rich-text (genuine
     text-edit) triggers the hide -- confirmed via this plan's own
     editing-trigger correctness test (list-touch.spec.ts, Task 2). */
  .affine-data-view-list-row:has(.affine-data-view-list-title:focus-within)
    .affine-data-view-list-note-action,
  .affine-data-view-list-row:has(.affine-data-view-list-title:focus-within)
    .affine-data-view-list-due-date-action,
  .affine-data-view-list-row:has(.affine-data-view-list-title:focus-within)
    .affine-data-view-list-drag-handle {
    visibility: hidden;
    opacity: 0;
  }

  /* RESEARCH.md Pitfall 3: preventDefault() on the drag handle's
     pointerdown-equivalent does not reliably suppress touch-scrolling in
     all browsers without this -- no existing rule anywhere in this
     package's drag-handle CSS sets it. */
  .affine-data-view-list-drag-handle {
    touch-action: none;
  }
`;

@customElement('affine-data-view-list')
export class ListViewRenderer extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  private readonly cellEditing$ = signal(true);

  // Story 2.8: mirrors `TableViewUI.connectedCallback`'s own
  // `this.logic.ui$.value = this` + controller `hostConnected()` wiring —
  // `ListDragController` needs a live DOM anchor to query rows/handles
  // from, and `hostConnected` is where it registers its `dragStart`
  // listener.
  override connectedCallback() {
    super.connectedCallback();
    this.logic.ui$.value = this;
    this.logic.dragController.hostConnected();
  }

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

    .affine-data-view-list-note-action {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-left: 4px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--affine-icon-color);
      visibility: hidden;
      opacity: 0;
    }

    .affine-data-view-list-row:hover .affine-data-view-list-note-action {
      visibility: visible;
      opacity: 1;
    }

    .affine-data-view-list-note-action:hover {
      background: var(--affine-hover-color);
    }

    .affine-data-view-list-due-date-action {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-left: 4px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--affine-icon-color);
      visibility: hidden;
      opacity: 0;
    }

    .affine-data-view-list-row:hover .affine-data-view-list-due-date-action {
      visibility: visible;
      opacity: 1;
    }

    .affine-data-view-list-due-date-action:hover {
      background: var(--affine-hover-color);
    }

    /* Story 2.8: left-side drag handle — visually mirrors table view's own
       .data-view-table-view-drag-handler (table/pc/row/row.ts): same
       grey pill, same hover-only visibility, same grab cursor. Sits before
       the indent spacer so it stays at a consistent near-left position
       regardless of the row's own hierarchy depth (matching table's
       dedicated left-bar column, which also never indents). */
    .affine-data-view-list-drag-handle {
      width: 12px;
      height: 20px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      visibility: hidden;
      opacity: 0;
    }

    .affine-data-view-list-row:hover .affine-data-view-list-drag-handle {
      visibility: visible;
      opacity: 1;
    }

    .affine-data-view-list-indent-spacer {
      flex-shrink: 0;
    }

    ${IS_MOBILE ? mobileListActionStyles : css``}
  `;

  @property({ attribute: false })
  accessor logic!: ListViewUILogic;

  private get view() {
    return this.logic.view;
  }

  private get noteCapableDataSource(): TaskWorkflowCapableDataSource {
    return this.view.manager
      .dataSource as unknown as TaskWorkflowCapableDataSource;
  }

  private get std(): BlockStdScope | undefined {
    return this.view.serviceGet(EditorHostKey)?.std;
  }

  /**
   * The row's own persistent highlight — independent of whether a
   * `note-ref` currently exists on *this* page (a carried-over task's Note
   * reference can be set from an earlier day, long before this exact page
   * ever reveals/inserts it) — per direct user request: the row itself
   * should always show its assigned color the moment the row is rendered
   * on any page, since that's the visual cue "this task is in-progress /
   * has a note", not just a hover affordance.
   */
  private getRowNoteColor(rowId: string): string | undefined {
    const dataSource = this.noteCapableDataSource;
    if (typeof dataSource.getResolvedNoteColor !== 'function') {
      return undefined;
    }
    const std = this.std;
    if (!std) return undefined;
    return dataSource.getResolvedNoteColor(std, rowId);
  }

  /**
   * Story 2.7: overdue-and-undone treatment for this row — `null` if
   * neither highlight nor hide applies (see `DatabaseBlockDataSource.
   * getDueDateHighlightState`'s own doc comment for the full condition).
   */
  private getRowDueDateState(rowId: string): 'highlight' | 'hide' | null {
    const dataSource = this.noteCapableDataSource;
    if (typeof dataSource.getDueDateHighlightState !== 'function') {
      return null;
    }
    const std = this.std;
    if (!std) return null;
    return dataSource.getDueDateHighlightState(std, rowId);
  }

  /**
   * Row-level "attach a note" button (Story 2.6) — gated on the data
   * source actually being todo-capable (`getTaskStatusColumn` present and
   * resolving), per direct user request: a plain generic database/reference
   * table should never grow this button, only a Journal Todo-style table.
   * CSS-`:hover`-revealed, mirroring `table/pc/row/row.ts`'s own
   * `.show-on-hover-row` pattern (list rows are plain, non-virtualized DOM,
   * so CSS `:hover` scopes correctly here, unlike the virtualized table
   * variant).
   */
  private renderNoteAction(rowId: string) {
    const dataSource = this.noteCapableDataSource;
    if (typeof dataSource.getTaskStatusColumn !== 'function') {
      return nothing;
    }
    if (!dataSource.getTaskStatusColumn()) {
      return nothing;
    }
    const std = this.std;
    if (!std) {
      return nothing;
    }

    const ref = dataSource.getNoteRef?.(rowId);
    if (!ref) {
      const onClick = (e: MouseEvent) => {
        e.stopPropagation();
        popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
          options: {
            items: [
              menu.action({
                name: 'New note',
                prefix: PageIcon(),
                select: () => {
                  dataSource.createNoteForRow?.(std, rowId);
                },
              }),
              menu.action({
                name: 'Link existing note',
                prefix: PageIcon(),
                select: () => {
                  dataSource
                    .attachExistingNoteForRow?.(std, rowId)
                    .catch(console.error);
                },
              }),
            ],
          },
        });
      };
      return html`<div
        class="affine-data-view-list-note-action"
        data-testid="note-action-create"
        @click=${onClick}
      >
        ${PlusIcon()}
      </div>`;
    }

    const color = dataSource.getResolvedNoteColor?.(std, rowId);
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      dataSource.revealOrInsertNoteForRow?.(std, rowId);
    };
    return html`<div
      class="affine-data-view-list-note-action"
      data-testid="note-action-open"
      style=${color ? `color: ${color};` : ''}
      @click=${onClick}
    >
      ${PageIcon()}
    </div>`;
  }

  // Keyed by rowId — a single shared controller would make opening the
  // picker on one row silently no-op clicks on every other row's due-date
  // button while that first popup is still open.
  private readonly _dueDatePortalAbortControllers = new Map<
    string,
    AbortController
  >();

  /**
   * Row-level "set due date" button (Story 2.7, Task 3) — sibling to
   * `renderNoteAction`, same task-status-capability gating and CSS-`:hover`
   * mechanism. Variant (b) per the story's own Resolved Design Decision 5:
   * a plain date-selection dialog that writes `dueDate` and does not touch
   * column visibility. Reuses the exact same `DatePicker`/`createLitPortal`
   * combination the Date property's own cell editor uses
   * (`property-presets/date/cell-renderer.ts`) rather than building a new
   * date-picker component.
   */
  private renderDueDateAction(rowId: string) {
    const dataSource = this.noteCapableDataSource;
    if (typeof dataSource.getTaskStatusColumn !== 'function') {
      return nothing;
    }
    if (!dataSource.getTaskStatusColumn()) {
      return nothing;
    }
    if (typeof dataSource.setDueDateForRow !== 'function') {
      return nothing;
    }
    const std = this.std;
    if (!std) {
      return nothing;
    }

    const currentValue = dataSource.getDueDateForRow?.(rowId);

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const existing = this._dueDatePortalAbortControllers.get(rowId);
      if (existing && !existing.signal.aborted) {
        return;
      }
      const target = e.currentTarget as HTMLElement;
      const abortController = new AbortController();
      this._dueDatePortalAbortControllers.set(rowId, abortController);
      const { portal } = createLitPortal({
        abortController,
        closeOnClickAway: true,
        computePosition: {
          referenceElement: target,
          placement: 'bottom',
          middleware: [offset(10), flip()],
        },
        template: () => {
          const datePicker = new DatePicker();
          datePicker.value = currentValue ?? Date.now();
          datePicker.popup = true;
          datePicker.onClear = () => {
            dataSource.setDueDateForRow?.(std, rowId, undefined);
            abortController.abort();
          };
          datePicker.onChange = (date: Date) => {
            dataSource.setDueDateForRow?.(std, rowId, date.getTime());
            abortController.abort();
          };
          datePicker.onEscape = () => {
            abortController.abort();
          };
          requestAnimationFrame(() => datePicker.focusDateCell());
          return datePicker;
        },
      });
      portal.style.zIndex = '1002';
    };

    return html`<div
      class="affine-data-view-list-due-date-action"
      data-testid="due-date-action"
      @click=${onClick}
    >
      ${DateTimeIcon()}
    </div>`;
  }

  /**
   * Story 2.8: left-side drag handle — only rendered for a todo-capable,
   * non-readonly view (same gating `renderNoteAction`/`renderDueDateAction`
   * already use for their own todo-only affordances). The handle itself is
   * inert here (no drag wiring) — `ListDragController` (Story 2.8, Task 1)
   * owns starting a drag from it, matching table's own separation between
   * this file's markup and `table/pc/controller/drag.ts`'s event handling.
   */
  private renderDragHandle(rowId: string) {
    const dataSource = this.noteCapableDataSource;
    if (typeof dataSource.getTaskStatusColumn !== 'function') {
      return nothing;
    }
    if (!dataSource.getTaskStatusColumn()) {
      return nothing;
    }
    if (this.view.readonly$.value) {
      return nothing;
    }
    return html`<div
      class="affine-data-view-list-drag-handle"
      data-testid="drag-handle"
      data-row-id=${rowId}
    >
      <div
        style="width: 4px;
        border-radius: 2px;
        height: 12px;
        background-color: var(--affine-placeholder-color);"
      ></div>
    </div>`;
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
  private onRowFocusIn(event: FocusEvent) {
    const rowId = (event.currentTarget as HTMLElement | null)?.dataset.rowId;
    if (rowId) {
      this.logic.ensureTodoListRow(rowId);
    }
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
    this.logic.ensureTodoListRow(rowId);
    if (event.key === 'Backspace') {
      if (this.view.readonly$.value) {
        return;
      }
      const richText = (
        event.currentTarget as HTMLElement
      ).querySelector<
        HTMLElement & {
          inlineEditor?: {
            getInlineRange?: () => { index: number; length: number } | null;
          };
        }
      >('rich-text');
      const range = richText?.inlineEditor?.getInlineRange?.();
      if (!range) {
        return;
      }
      if (range.index !== 0 || range.length !== 0) {
        return;
      }
      const rows = this.view.rows$.value;
      const rowIndex = rows.findIndex(r => r.rowId === rowId);
      if (rowIndex <= 0) {
        return;
      }
      const prevRowId = rows[rowIndex - 1]?.rowId;
      const model = this.std?.store.getBlock(rowId)?.model;
      if (!prevRowId || !model || !this.std) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      mergeWithPrev(this.std.host, model);
      this.focusRowTitle(prevRowId);
      return;
    }
    if (event.key === 'Delete') {
      if (this.view.readonly$.value) {
        return;
      }
      const richText = (
        event.currentTarget as HTMLElement
      ).querySelector<
        HTMLElement & {
          inlineEditor?: {
            getInlineRange?: () => { index: number; length: number } | null;
          };
        }
      >('rich-text');
      const range = richText?.inlineEditor?.getInlineRange?.();
      const model = this.std?.store.getBlock(rowId)?.model;
      if (!model || !this.std) {
        return;
      }
      if (!range || range.length !== 0) {
        return;
      }
      if (range.index !== (model.text?.length ?? 0)) {
        return;
      }
      const rows = this.view.rows$.value;
      const rowIndex = rows.findIndex(r => r.rowId === rowId);
      const nextRowId = rows[rowIndex + 1]?.rowId;
      if (!nextRowId) {
        return;
      }
      const nextModel = this.std.store.getBlock(nextRowId)?.model;
      if (!nextModel) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      mergeWithPrev(this.std.host, nextModel);
      this.focusRowTitle(rowId);
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
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const rowIds = this.view.rows$.value.map(row => row.rowId);
      const index = rowIds.indexOf(rowId);
      if (index < 0) {
        return;
      }
      const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
      const targetRowId = rowIds[targetIndex];
      if (!targetRowId) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      this.focusRowTitle(targetRowId);
    }
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.logic) {
      return nothing;
    }
    const titleColumn = this.view.mainProperties$.value.titleColumn;
    let detailProperties = this.view.detailProperties$.value.filter(
      property => property.id !== titleColumn
    );
    // Story 2.7 (live-render fix): force Due date into the rendered detail
    // fields when the live "Show 'Due date' in Journal todo" setting is on
    // — regardless of whatever the column's *persisted* hide flag says.
    // The persisted flag is only a creation-time default (see
    // `getShowDueDateColumnSetting`'s own doc comment); this is the
    // reliable, always-correct path, mirroring `getRowDueDateState`'s own
    // already-proven live-read-on-every-render pattern.
    const dataSource = this.noteCapableDataSource;
    const std = this.std;
    if (
      std &&
      typeof dataSource.getShowDueDateColumnSetting === 'function' &&
      typeof dataSource.getDueDateColumn === 'function' &&
      dataSource.getShowDueDateColumnSetting(std)
    ) {
      const dueDateColumnId = dataSource.getDueDateColumn()?.id;
      // An *explicit* `hide: true` entry (as opposed to no entry at all,
      // which just means "never touched, follow the global default") means
      // a user deliberately hid this column via the properties menu for
      // this specific view — that manual choice must stick even while the
      // global setting is on (Decision 1/AC1's "always sticks" guarantee).
      const explicitlyHidden =
        dueDateColumnId != null &&
        this.view.data$.value?.columns.find(
          column => column.id === dueDateColumnId
        )?.hide === true;
      if (
        dueDateColumnId &&
        !explicitlyHidden &&
        !detailProperties.some(property => property.id === dueDateColumnId)
      ) {
        const dueDateProperty = this.view.propertyGetOrCreate(dueDateColumnId);
        detailProperties = [...detailProperties, dueDateProperty];
      }
    }
    const fieldLayout = this.view.fieldLayout$.value;
    // Deferred to a microtask rather than run synchronously inline here:
    // `ensureTodoListRows` -> `ensureRowAsTodoList` can `deleteBlock` then
    // `addBlock` a row (converting a plain paragraph to a todo `affine:list`
    // with the same id) as two separate, non-transactional ops — mutating
    // the doc *while this very render() call is still executing* raced the
    // `repeat()` directive below (which reads `this.view.rows$.value`
    // again, moments later, in the same call) against whatever the
    // block-tree's own reactive rendering was doing in response to that
    // same delete+recreate, and could leave the list showing no rows at
    // all until something else forced a further render. Matches
    // `TableSingleView`'s/`KanbanSingleView`'s own established
    // `queueMicrotask` pattern for this exact class of "mutate once the
    // current render settles" need.
    //
    // Deliberately never calls `requestUpdate()` off the back of this:
    // `ensureRowAsTodoList`'s return value means "is this row todo-type"
    // (true for a row that *was already* todo, per its own tested
    // contract — see `database.unit.spec.ts`), not "did a conversion just
    // happen" — so using it to decide whether to force a re-render means
    // any list view with even one pre-existing todo row returns `true`
    // forever, on every single render, forcing another `requestUpdate()`
    // every time: a genuine infinite render loop (confirmed live — it
    // froze the page). The one case that actually needs a re-render (a
    // paragraph really converted to `affine:list`) already changes
    // `model.children`, which `SignalWatcher` already re-renders for via
    // the normal `rows$` reactivity — no manual trigger needed.
    queueMicrotask(() => {
      this.logic.ensureTodoListRows(
        this.view.rows$.value.map(row => row.rowId)
      );
    });
    return html`${this.logic.headerWidget
        ? renderUniLit(this.logic.headerWidget, { dataViewLogic: this.logic })
        : nothing}
      <div class="affine-data-view-list">
        ${repeat(
          // Story 2.7 (AC5): a row whose resolved overdue-and-undone
          // setting is `'hide'` is excluded from the list entirely — not
          // hidden via CSS, since it should also not occupy layout space
          // or be tab-reachable, matching the "excluded from view" wording
          // of the AC (as opposed to `'highlight'`, which stays visible).
          this.view.rows$.value.filter(
            row => this.getRowDueDateState(row.rowId) !== 'hide'
          ),
          row => row.rowId,
          row => {
            const indent = this.getHierarchyLevel(row.rowId) * 24;
            const noteColor = this.getRowNoteColor(row.rowId);
            const isOverdueHighlighted =
              this.getRowDueDateState(row.rowId) === 'highlight';
            return html`<div
              class="affine-data-view-list-row"
              data-row-id=${row.rowId}
              data-overdue=${isOverdueHighlighted ? 'true' : nothing}
              tabindex="0"
              style="${noteColor
                ? `background-color: ${noteColor}; border-radius: 6px;`
                : ''}${isOverdueHighlighted
                ? ' color: var(--affine-error-color); font-weight: 600;'
                : ''}"
              @focusin=${this.onRowFocusIn}
              @keydown=${this.onRowKeyDown}
            >
              ${this.renderDragHandle(row.rowId)}
              <div
                class="affine-data-view-list-indent-spacer"
                style="width: ${indent}px"
              ></div>
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
              ${this.renderNoteAction(row.rowId)}
              ${this.renderDueDateAction(row.rowId)}
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
