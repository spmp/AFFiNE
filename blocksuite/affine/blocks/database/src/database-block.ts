import { CaptionedBlockComponent } from '@blocksuite/affine-components/caption';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { DropIndicator } from '@blocksuite/affine-components/drop-indicator';
import { PeekViewProvider } from '@blocksuite/affine-components/peek';
import { toast } from '@blocksuite/affine-components/toast';
import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import { EDGELESS_TOP_CONTENTEDITABLE_SELECTOR } from '@blocksuite/affine-shared/consts';
import {
  BlockElementCommentManager,
  CommentProviderIdentifier,
  DocModeProvider,
  FeatureFlagService,
  NotificationProvider,
  type TelemetryEventMap,
  TelemetryProvider,
} from '@blocksuite/affine-shared/services';
import {
  TASK_INTEROP_UPDATED_EVENT,
  type TaskInteropUpdatedDetail,
} from '@blocksuite/affine-shared/utils';
import { getDropResult } from '@blocksuite/affine-widget-drag-handle';
import {
  createRecordDetail,
  createUniComponentFromWebComponent,
  DataViewRootUILogic,
  type DataViewSelection,
  type DataViewUILogicBase,
  type DataViewWidget,
  type DataViewWidgetProps,
  defineUniComponent,
  ExternalGroupByConfigProvider,
  lazy,
  renderUniLit,
  type SingleView,
  uniMap,
} from '@blocksuite/data-view';
import { CalendarExternalSourceProvider } from '@blocksuite/data-view/view-presets';
import { widgetPresets } from '@blocksuite/data-view/widget-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { Rect } from '@blocksuite/global/gfx';
import {
  CommentIcon,
  CopyIcon,
  DeleteIcon,
  MoreHorizontalIcon,
  SettingsIcon,
} from '@blocksuite/icons/lit';
import { type BlockComponent, BlockSelection } from '@blocksuite/std';
import { RANGE_SYNC_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import { Slice } from '@blocksuite/store';
import { autoUpdate } from '@floating-ui/dom';
import { computed, signal } from '@preact/signals-core';
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { popSideDetail } from './components/layout.js';
import { DatabaseConfigExtension } from './config.js';
import { EditorHostKey } from './context/host-context.js';
import { DatabaseBlockDataSource } from './data-source.js';
import {
  databaseBlockStyles,
  databaseContentStyles,
  databaseHeaderBarStyles,
  databaseHeaderContainerStyles,
  databaseOpsStyles,
  databaseTitleRowStyles,
  databaseTitleStyles,
  databaseToolbarRowStyles,
  databaseViewBarContainerStyles,
} from './database-block-styles.js';
import { BlockRenderer } from './detail-panel/block-renderer.js';
import { NoteRenderer } from './detail-panel/note-renderer.js';
import { DatabaseSelection } from './selection.js';
import { getSingleDocIdFromText } from './utils/title-doc.js';
import type { DatabaseViewExtensionOptions } from './view';

export function resolveTaskInteropTargetRow(
  rowLookup: ReturnType<DatabaseBlockDataSource['findRowByTaskIdentity']>,
  fallbackRowId?: string
) {
  if (rowLookup.status === 'unique') {
    return rowLookup.rowId;
  }
  if (rowLookup.status === 'missing') {
    return fallbackRowId;
  }
  return null;
}

export class DatabaseBlockComponent extends CaptionedBlockComponent<DatabaseBlockModel> {
  private readonly clickDatabaseOps = (e: MouseEvent) => {
    const dataSource = this.dataSource.value;
    const options = this.optionsConfig.configure(this.model, {
      items: [
        menu.input({
          initialValue: this.model.props.title.toString(),
          placeholder: 'Database title',
          onChange: text => {
            this.model.props.title.replace(
              0,
              this.model.props.title.length,
              text
            );
          },
        }),
        menu.action({
          prefix: CommentIcon(),
          name: 'Comment',
          hide: () => !this.std.getOptional(CommentProviderIdentifier),
          select: () => {
            this.std.getOptional(CommentProviderIdentifier)?.addComment([
              new BlockSelection({
                blockId: this.blockId,
              }),
            ]);
          },
        }),
        menu.action({
          prefix: CopyIcon(),
          name: 'Copy',
          select: () => {
            const slice = Slice.fromModels(this.store, [this.model]);
            this.std.clipboard
              .copySlice(slice)
              .then(() => {
                toast(this.host, 'Copied to clipboard');
              })
              .catch(console.error);
          },
        }),
        menu.action({
          name: 'Settings',
          prefix: SettingsIcon(),
          closeOnSelect: false,
          select: ele => {
            const currentInheritance = dataSource.getTaskStatusInheritance?.();
            popMenu(popupTargetFromElement(ele), {
              options: {
                items: [
                  menu.group({
                    name: 'Parent status behavior',
                    items: [
                      menu.toggleSwitch({
                        name: 'Done when all children are done',
                        on:
                          currentInheritance?.done ===
                          'require-all-subtasks-complete',
                        onChange: on => {
                          dataSource.setTaskStatusInheritance?.({
                            done: on
                              ? 'require-all-subtasks-complete'
                              : 'disabled',
                          });
                        },
                      }),
                      menu.toggleSwitch({
                        name: 'In progress when any child starts',
                        on:
                          currentInheritance?.inProgress ===
                          'start-when-any-subtask-starts',
                        onChange: on => {
                          dataSource.setTaskStatusInheritance?.({
                            inProgress: on
                              ? 'start-when-any-subtask-starts'
                              : 'disabled',
                          });
                        },
                      }),
                      menu.toggleSwitch({
                        name: 'Auto-demote auto-derived Done',
                        on: currentInheritance?.autoDemoteAutoDone ?? true,
                        onChange: on => {
                          dataSource.setTaskStatusInheritance?.({
                            autoDemoteAutoDone: on,
                          });
                        },
                      }),
                      menu.toggleSwitch({
                        name: 'Manual Done cascades to descendants',
                        on:
                          currentInheritance?.cascadeManualDoneToDescendants ??
                          true,
                        onChange: on => {
                          dataSource.setTaskStatusInheritance?.({
                            cascadeManualDoneToDescendants: on,
                          });
                        },
                      }),
                    ],
                  }),
                ],
              },
            });
          },
        }),
        menu.group({
          items: [
            menu.action({
              prefix: DeleteIcon(),
              class: {
                'delete-item': true,
              },
              name: 'Delete Database',
              select: () => {
                this.model.children.slice().forEach(block => {
                  this.store.deleteBlock(block);
                });
                this.store.deleteBlock(this.model);
              },
            }),
          ],
        }),
      ],
    });

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options,
    });
  };

  private readonly dataSource = lazy(() => {
    const dataSource = new DatabaseBlockDataSource(this.model, dataSource => {
      dataSource.serviceSet(EditorHostKey, this.host);
      this.std.provider
        .getAll(ExternalGroupByConfigProvider)
        .forEach(config => {
          dataSource.serviceSet(
            ExternalGroupByConfigProvider(config.name),
            config
          );
        });
      this.std.provider
        .getAll(CalendarExternalSourceProvider)
        .forEach(source => {
          dataSource.serviceSet(
            CalendarExternalSourceProvider(source.id),
            source
          );
        });
    });
    // Skip when rendered nested inside a `database-ref` wrapper: `this.model`
    // there is the *shared* canonical table, the same object for every
    // reference to it, so applying/persisting a "last used view" through it
    // here would let one reference's tab choice leak into every other
    // reference (and, on the next remount, get stamped back onto all of
    // them, discarding their own distinct choices — confirmed live via a
    // `setCurrentView` call trace: a reference's construction-time default
    // apply was picking up whatever view another reference's tab click had
    // last written into this exact shared prop). `database-ref-block.ts`'s
    // own `_syncCurrentView` is the sole source of truth for the nested
    // case, persisting to each reference's own model instead.
    if (!this.closest('affine-database-ref')) {
      const id = this.model.props.currentViewId;
      if (id && dataSource.viewManager.viewGet(id)) {
        dataSource.viewManager.setCurrentView(id);
      }
    }
    return dataSource;
  });

  private readonly renderTitle = (dataViewLogic: DataViewUILogicBase) => {
    return html` <affine-database-title
      class="${databaseTitleStyles}"
      .titleText="${this.model.props.title}"
      .dataViewLogic="${dataViewLogic}"
    ></affine-database-title>`;
  };

  createTemplate = (
    data: {
      view: SingleView;
      rowId: string;
    },
    openDoc: (docId: string) => void
  ) => {
    return createRecordDetail({
      ...data,
      openDoc,
      detail: {
        header: uniMap(
          createUniComponentFromWebComponent(BlockRenderer),
          props => ({
            ...props,
            host: this.host,
          })
        ),
        note: uniMap(
          createUniComponentFromWebComponent(NoteRenderer),
          props => ({
            ...props,
            model: this.model,
            host: this.host,
          })
        ),
      },
    });
  };

  headerWidget: DataViewWidget = defineUniComponent(
    (props: DataViewWidgetProps) => {
      return html`
        <div class="${databaseHeaderContainerStyles}">
          <div class="${databaseTitleRowStyles}">
            ${this.renderTitle(props.dataViewLogic)} ${this.renderDatabaseOps()}
          </div>
          <div class="${databaseToolbarRowStyles} ${databaseHeaderBarStyles}">
            <div class="${databaseViewBarContainerStyles}">
              ${renderUniLit(widgetPresets.viewBar, {
                ...props,
                onChangeView: id => {
                  if (!this.closest('affine-database-ref')) {
                    this.model.props.currentViewId = id;
                  }
                },
              })}
            </div>
            ${renderUniLit(this.toolsWidget, props)}
          </div>
          ${renderUniLit(widgetPresets.quickSettingBar, props)}
        </div>
      `;
    }
  );

  indicator = new DropIndicator();

  onDrag = (evt: MouseEvent, id: string): (() => void) => {
    const result = getDropResult(evt);
    if (result && result.rect) {
      document.body.append(this.indicator);
      this.indicator.rect = Rect.fromLWTH(
        result.rect.left,
        result.rect.width,
        result.rect.top,
        result.rect.height
      );
      return () => {
        this.indicator.remove();
        const model = this.store.getBlock(id)?.model;
        const target = result.modelState.model;
        let parent = this.store.getParent(target.id);
        const shouldInsertIn = result.placement === 'in';
        if (shouldInsertIn) {
          parent = target;
        }
        if (model && target && parent) {
          if (shouldInsertIn) {
            this.store.moveBlocks([model], parent);
          } else {
            this.store.moveBlocks(
              [model],
              parent,
              target,
              result.placement === 'before'
            );
          }
        }
      };
    }
    this.indicator.remove();
    return () => {};
  };

  private readonly setSelection = (
    selection: DataViewSelection | undefined
  ) => {
    if (selection) {
      getSelection()?.removeAllRanges();
    }
    this.selection.setGroup(
      'note',
      selection
        ? [
            new DatabaseSelection({
              blockId: this.blockId,
              viewSelection: selection,
            }),
          ]
        : []
    );
  };

  private readonly toolsWidget: DataViewWidget = widgetPresets.createTools({
    table: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    kanban: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    calendar: [
      widgetPresets.tools.filter,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
  });

  private readonly viewSelection$ = computed(() => {
    const databaseSelection = this.selection.value.find(
      (selection): selection is DatabaseSelection => {
        if (selection.blockId !== this.blockId) {
          return false;
        }
        return selection instanceof DatabaseSelection;
      }
    );
    return databaseSelection?.viewSelection;
  });

  private readonly virtualPadding$ = signal(0);

  get optionsConfig(): DatabaseViewExtensionOptions {
    return {
      configure: (_model, options) => options,
      ...this.std.getOptional(DatabaseConfigExtension.identifier),
    };
  }

  get isCommentHighlighted() {
    return (
      this.std
        .getOptional(BlockElementCommentManager)
        ?.isBlockCommentHighlighted(this.model) ?? false
    );
  }

  override get topContenteditableElement() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return this.closest<BlockComponent>(
        EDGELESS_TOP_CONTENTEDITABLE_SELECTOR
      );
    }
    return this.rootComponent;
  }

  private renderDatabaseOps() {
    if (this.dataSource.value.readonly$.value) {
      return nothing;
    }
    return html` <div
      data-testid="database-ops"
      class="${databaseOpsStyles}"
      @click="${this.clickDatabaseOps}"
    >
      ${MoreHorizontalIcon()}
    </div>`;
  }

  override connectedCallback() {
    super.connectedCallback();

    this.setAttribute(RANGE_SYNC_EXCLUDE_ATTR, 'true');
    this.classList.add(databaseBlockStyles);
    this.listenFullWidthChange();
    this.handleMobileEditing();
    this.handleTaskInteropUpdates();
  }

  private handleTaskInteropUpdates() {
    this.disposables.addFromEvent(
      this.host,
      TASK_INTEROP_UPDATED_EVENT,
      (event: Event) => {
        const customEvent = event as CustomEvent<TaskInteropUpdatedDetail>;
        const detail = customEvent.detail;
        if (!detail?.link) {
          return;
        }

        const dataSource = this.dataSource.value;
        const rowLookup = dataSource.findRowByTaskIdentity(
          detail.link.taskIdentity
        );
        const rowId = resolveTaskInteropTargetRow(
          rowLookup,
          detail.link.databaseRowId
        );

        if (!rowId) {
          return;
        }

        dataSource.setTaskInteropLink(rowId, {
          taskIdentity: detail.link.taskIdentity,
          docId: detail.link.docId,
          blockId: detail.link.blockId,
          sourceFlavor: detail.link.sourceFlavor,
          databaseId: this.blockId,
          databaseRowId: rowId,
        });
      }
    );
  }

  listenFullWidthChange() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return;
    }
    this.disposables.add(
      autoUpdate(this.host, this, () => {
        const padding =
          this.getBoundingClientRect().left -
          this.host.getBoundingClientRect().left;
        this.virtualPadding$.value = Math.max(0, padding - 72);
      })
    );
  }

  handleMobileEditing() {
    if (!IS_MOBILE) return;

    let notifyClosed = true;
    const handler = () => {
      if (
        !this.std
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing')
      ) {
        const notification = this.std.getOptional(NotificationProvider);
        if (notification && notifyClosed) {
          notifyClosed = false;
          notification.notify({
            title: html`<div
              style=${styleMap({
                whiteSpace: 'wrap',
              })}
            >
              Mobile database editing is not supported yet. You can open it in
              experimental features, or edit it in desktop mode.
            </div>`,
            accent: 'warning',
            onClose: () => {
              notifyClosed = true;
            },
          });
        }
      }
    };

    this.disposables.addFromEvent(this, 'click', handler);
  }

  private readonly dataViewRootLogic = lazy(
    () =>
      new DataViewRootUILogic({
        virtualPadding$: this.virtualPadding$,
        bindHotkey: hotkeys => {
          return {
            dispose: this.host.event.bindHotkey(hotkeys, {
              blockId: this.topContenteditableElement?.blockId ?? this.blockId,
            }),
          };
        },
        handleEvent: (name, handler) => {
          return {
            dispose: this.host.event.add(name, handler, {
              blockId: this.blockId,
            }),
          };
        },
        selection$: this.viewSelection$,
        setSelection: this.setSelection,
        dataSource: this.dataSource.value,
        headerWidget: this.headerWidget,
        onDrag: this.onDrag,
        clipboard: this.std.clipboard,
        dnd: this.std.dnd,
        notification: {
          toast: message => {
            const notification = this.std.getOptional(NotificationProvider);
            if (notification) {
              notification.toast(message);
            } else {
              toast(this.host, message);
            }
          },
        },
        eventTrace: (key, params) => {
          const telemetryService = this.std.getOptional(TelemetryProvider);
          telemetryService?.track(key, {
            ...(params as TelemetryEventMap[typeof key]),
            blockId: this.blockId,
          });
        },
        detailPanelConfig: {
          openDetailPanel: (target, data) => {
            const peekViewService = this.std.getOptional(PeekViewProvider);
            if (peekViewService) {
              const openDoc = (docId: string) => {
                return peekViewService.peek({
                  docId,
                  databaseId: this.blockId,
                  databaseDocId: this.model.store.id,
                  databaseRowId: data.rowId,
                  target: this,
                });
              };
              const doc = getSingleDocIdFromText(
                this.model.store.getBlock(data.rowId)?.model?.text
              );
              if (doc) {
                return openDoc(doc);
              }
              const abort = new AbortController();
              return new Promise<void>(focusBack => {
                peekViewService
                  .peek(
                    {
                      target,
                      template: this.createTemplate(data, docId => {
                        // abort.abort();
                        openDoc(docId).then(focusBack).catch(focusBack);
                      }),
                    },
                    { abortSignal: abort.signal }
                  )
                  .then(focusBack)
                  .catch(focusBack);
              });
            } else {
              return popSideDetail(
                this.createTemplate(data, () => {
                  //
                })
              );
            }
          },
        },
      })
  );
  override renderBlock() {
    const widgets = html`${repeat(
      Object.entries(this.widgets),
      ([id]) => id,
      ([_, widget]) => widget
    )}`;

    return html`
      <div contenteditable="false" class="${databaseContentStyles}">
        ${this.dataViewRootLogic.value.render()} ${widgets}
      </div>
    `;
  }

  override accessor useZeroWidth = true;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database': DatabaseBlockComponent;
  }
}
