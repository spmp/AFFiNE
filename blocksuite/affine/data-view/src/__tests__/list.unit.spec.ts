import { signal } from '@preact/signals-core';
import { nothing } from 'lit';
import { afterEach, describe, expect, test } from 'vitest';

import type { ViewManager } from '../core/view-manager/view-manager.js';
import { ViewManagerBase } from '../core/view-manager/view-manager.js';
import { viewConverts, viewPresets } from '../view-presets/index.js';
import { ListSingleView, listViewModel } from '../view-presets/list/index.js';
import { ListDragController } from '../view-presets/list/pc/controller/drag.js';
import { ListViewUILogic } from '../view-presets/list/pc/list-view-ui-logic.js';
import { ListViewRenderer } from '../view-presets/list/pc/renderer.js';
import {
  computeIndentMutation,
  computeUnindentMutation,
} from '../view-presets/table/utils.js';

const getListRendererSource = () =>
  ListViewRenderer.prototype.render.toString();

const createMockViewManager = (
  properties: string[],
  taskStatusColumnId?: string
) =>
  ({
    dataSource: {
      properties$: signal(properties),
      propertyTypeGet: (id: string) =>
        id === 'title'
          ? 'title'
          : id === 'status' || id === 'owner'
            ? 'select'
            : 'text',
      propertyNameGet: (id: string) => id,
      getTaskStatusColumn: taskStatusColumnId
        ? () => ({ id: taskStatusColumnId })
        : undefined,
    },
  }) as unknown as ViewManager;

const createHierarchyProperty = (
  values: Map<string, unknown>,
  id: string,
  name: string
) => ({
  id,
  name$: { value: name },
  stringValueGet: (rowId: string) => String(values.get(`${id}:${rowId}`) ?? ''),
  cellGetOrCreate: (rowId: string) => ({
    jsonValue$: { value: values.get(`${id}:${rowId}`) },
  }),
  valueSetFromString: (rowId: string, value: string) => {
    values.set(`${id}:${rowId}`, value);
  },
});

describe('list view preset', () => {
  test('registers list view preset metadata', () => {
    expect(viewPresets.listViewMeta.type).toBe('list');
    expect(viewPresets.listViewMeta.model.dataViewManager).toBe(ListSingleView);
  });

  test('creates non-destructive database list view data', () => {
    const data = listViewModel.model.defaultData(
      createMockViewManager(['title', 'status', 'owner', 'due'], 'status')
    );

    expect(data).toEqual({
      columns: [
        { id: 'title' },
        { id: 'status', hide: true },
        { id: 'owner' },
        { id: 'due' },
      ],
      filter: {
        type: 'group',
        op: 'and',
        conditions: [],
      },
      header: {
        titleColumn: 'title',
      },
      showAdditionalFields: true,
      fieldLayout: 'aligned',
    });
  });

  test('registers conversions without row mirroring data', () => {
    expect(
      viewConverts.some(
        convert => convert.from === 'table' && convert.to === 'list'
      )
    ).toBe(true);
    expect(
      viewConverts.some(
        convert => convert.from === 'list' && convert.to === 'table'
      )
    ).toBe(true);
    expect(
      viewConverts.some(
        convert => convert.from === 'kanban' && convert.to === 'list'
      )
    ).toBe(true);
    expect(
      viewConverts.some(
        convert => convert.from === 'list' && convert.to === 'kanban'
      )
    ).toBe(true);
  });

  test('list renderer satisfies the UniComponent lifecycle contract', () => {
    const logic = new ListViewUILogic(
      {} as never,
      {
        rows$: { value: [] },
        mainProperties$: { value: {} },
        detailProperties$: { value: [] },
      } as never
    );
    const host = document.createElement('div');

    const mounted = logic.renderer(host, { logic }, () => {});

    expect(typeof mounted.update).toBe('function');
    expect(typeof mounted.unmount).toBe('function');
    mounted.unmount();
    expect(host.childElementCount).toBe(0);
  });

  test('list renderer mounts cell renderers through uni-lit', () => {
    const cellRenderer = () => {
      throw new Error('cell renderer should be mounted by uni-lit');
    };
    const renderer = new ListViewRenderer();
    Object.assign(renderer, {
      logic: {
        view: {
          propertyGetOrCreate: () => ({
            meta$: {
              value: { renderer: { cellRenderer: { view: cellRenderer } } },
            },
          }),
          cellGetOrCreate: () => ({}),
        },
      },
    });

    const result = (
      renderer as unknown as {
        renderCell: (rowId: string, propertyId: string) => unknown;
      }
    ).renderCell('row-1', 'title');

    expect(result).toBeTruthy();
  });

  test('toggles additional field visibility as presentation state', () => {
    const updates: unknown[] = [];
    const view = {
      dataUpdate: (updater: (data: unknown) => unknown) => {
        updates.push(updater({ showAdditionalFields: true }));
      },
    } as unknown as ListSingleView;

    ListSingleView.prototype.setAdditionalFieldsVisible.call(view, false);

    expect(updates).toEqual([{ showAdditionalFields: false }]);
  });

  test('hiding additional fields does not filter rows', () => {
    const view = {
      filter$: {
        value: {
          type: 'group',
          op: 'and',
          conditions: [],
        },
      },
      showAdditionalFields$: { value: false },
    } as unknown as ListSingleView;

    expect(ListSingleView.prototype.isShow.call(view, 'row-1')).toBe(true);
    expect(ListSingleView.prototype.isShow.call(view, 'row-2')).toBe(true);
  });

  test('falls back when current view id is removed by undo', () => {
    const dataSource = {
      viewDataList$: signal([
        { id: 'table-view', mode: 'table' },
        { id: 'list-view', mode: 'list' },
      ]),
    };
    const manager = new ViewManagerBase(dataSource as never);

    manager.setCurrentView('list-view');
    expect(manager.currentViewId$.value).toBe('list-view');

    dataSource.viewDataList$.value = [{ id: 'table-view', mode: 'table' }];

    expect(manager.currentViewId$.value).toBe('table-view');
  });

  test('creates row after current row at the same hierarchy level', () => {
    const values = new Map<string, unknown>([
      ['level:row-1', 2],
      ['level:child-1', 3],
      ['level:grandchild-1', 4],
      ['level:row-sibling', 2],
      ['parent:row-1', 'parent-id'],
      ['ancestors:row-1', 'root|parent-id'],
    ]);
    let insertPosition: unknown;
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);
    const logic = {
      view: {
        rowIds$: { value: ['row-1', 'child-1', 'grandchild-1', 'row-sibling'] },
        rowAdd: (position: unknown) => {
          insertPosition = position;
          return 'row-2';
        },
        propertiesRaw$: {
          value: [
            property('level', 'Hierarchy Level'),
            property('parent', 'Parent Identifier'),
            property('ancestors', 'Ancestor Identifiers'),
          ],
        },
      },
    } as unknown as ListViewUILogic;

    expect(ListViewUILogic.prototype.addRowAfter.call(logic, 'row-1')).toBe(
      'row-2'
    );
    expect(insertPosition).toEqual({ before: true, id: 'row-sibling' });
    expect(values.get('level:row-2')).toBe('2');
    expect(values.get('parent:row-2')).toBe('parent-id');
    expect(values.get('ancestors:row-2')).toBe('root|parent-id');
  });

  test('adds follow-up rows through datasource TODO-list creation when available', () => {
    let insertPosition: unknown;
    const logic = {
      view: {
        rowIds$: { value: ['row-1'] },
        manager: {
          dataSource: {
            rowAddAsTodoList: (position: unknown) => {
              insertPosition = position;
              return 'todo-row';
            },
          },
        },
        rowAdd: () => {
          throw new Error('plain rowAdd should not be used');
        },
        propertiesRaw$: { value: [] },
      },
    } as unknown as ListViewUILogic;

    expect(ListViewUILogic.prototype.addRowAfter.call(logic, 'row-1')).toBe(
      'todo-row'
    );
    expect(insertPosition).toBe('end');
  });

  test('creates row after a grandchild without reordering surrounding hierarchy', () => {
    const values = new Map<string, unknown>([
      ['level:parent-1', 0],
      ['level:child-1', 1],
      ['level:grandchild-1', 2],
      ['level:grandchild-2', 2],
      ['level:child-2', 1],
      ['level:parent-2', 0],
      ['parent:grandchild-1', 'child-1-id'],
      ['ancestors:grandchild-1', 'parent-1-id|child-1-id'],
    ]);
    let insertPosition: unknown;
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);
    const logic = {
      view: {
        rowIds$: {
          value: [
            'parent-1',
            'child-1',
            'grandchild-1',
            'grandchild-2',
            'child-2',
            'parent-2',
          ],
        },
        rowAdd: (position: unknown) => {
          insertPosition = position;
          return 'new-grandchild';
        },
        propertiesRaw$: {
          value: [
            property('level', 'Hierarchy Level'),
            property('parent', 'Parent Identifier'),
            property('ancestors', 'Ancestor Identifiers'),
          ],
        },
      },
    } as unknown as ListViewUILogic;

    expect(
      ListViewUILogic.prototype.addRowAfter.call(logic, 'grandchild-1')
    ).toBe('new-grandchild');
    expect(insertPosition).toEqual({ before: true, id: 'grandchild-2' });
    expect(values.get('level:new-grandchild')).toBe('2');
    expect(values.get('parent:new-grandchild')).toBe('child-1-id');
    expect(values.get('ancestors:new-grandchild')).toBe(
      'parent-1-id|child-1-id'
    );
  });

  test('applies inserted row hierarchy through datasource mutation', () => {
    const values = new Map<string, unknown>([
      ['level:great-grandchild-1', 3],
      ['level:grandchild-2', 2],
      ['parent:great-grandchild-1', 'grandchild-1-id'],
      [
        'ancestors:great-grandchild-1',
        'parent-1-id|child-1-id|grandchild-1-id',
      ],
    ]);
    let insertedRowId = '';
    let updatedLevels: Map<string, number> | undefined;
    let updatedParents: Map<string, string | undefined> | undefined;
    let updatedAncestors: Map<string, string> | undefined;
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);
    const logic = {
      view: {
        rowIds$: {
          value: [
            'parent-1',
            'child-1',
            'grandchild-1',
            'great-grandchild-1',
            'grandchild-2',
          ],
        },
        manager: {
          dataSource: {
            rowAddAsTodoList: (position: unknown) => {
              expect(position).toEqual({ before: true, id: 'grandchild-2' });
              insertedRowId = 'new-great-grandchild';
              return insertedRowId;
            },
            applyTaskHierarchyMutation: (
              levels: Map<string, number>,
              parents: Map<string, string | undefined>,
              ancestors: Map<string, string>
            ) => {
              updatedLevels = levels;
              updatedParents = parents;
              updatedAncestors = ancestors;
            },
          },
        },
        rowAdd: () => {
          insertedRowId = 'new-great-grandchild';
          return insertedRowId;
        },
        propertiesRaw$: {
          value: [
            property('level', 'Hierarchy Level'),
            property('parent', 'Parent Identifier'),
            property('ancestors', 'Ancestor Identifiers'),
          ],
        },
      },
    } as unknown as ListViewUILogic;

    expect(
      ListViewUILogic.prototype.addRowAfter.call(logic, 'great-grandchild-1')
    ).toBe('new-great-grandchild');
    expect(updatedLevels?.get(insertedRowId)).toBe(3);
    expect(updatedParents?.get(insertedRowId)).toBe('grandchild-1-id');
    expect(updatedAncestors?.get(insertedRowId)).toBe(
      'parent-1-id|child-1-id|grandchild-1-id'
    );
  });

  test('indents a root-level continuation row to match nested previous row level', () => {
    const values = new Map<string, unknown>([
      ['level:above', 4],
      ['level:new-row', 0],
      ['ancestors:above', '|doc:root|doc:parent|doc:child|doc:grandchild|'],
      ['ancestors:new-row', ''],
    ]);
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);

    const result = computeIndentMutation({
      rowIds: ['above', 'new-row'],
      rowId: 'new-row',
      docId: 'doc',
      properties: [
        property('level', 'Hierarchy Level'),
        property('parent', 'Parent Identifier'),
        property('ancestors', 'Ancestor Identifiers'),
      ],
    });

    expect(result?.updatedLevels.get('new-row')).toBe(4);
  });

  test('indents a nested row below a same-level previous row as a child', () => {
    const values = new Map<string, unknown>([
      ['level:above', 4],
      ['level:row', 4],
      ['ancestors:above', '|doc:root|doc:parent|doc:child|doc:grandchild|'],
      ['ancestors:row', '|doc:root|doc:parent|doc:child|doc:grandchild|'],
    ]);
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);

    const result = computeIndentMutation({
      rowIds: ['above', 'row'],
      rowId: 'row',
      docId: 'doc',
      properties: [
        property('level', 'Hierarchy Level'),
        property('parent', 'Parent Identifier'),
        property('ancestors', 'Ancestor Identifiers'),
      ],
    });

    expect(result?.updatedLevels.get('row')).toBe(5);
  });

  test('unindents one hierarchy level when parent metadata is rich-text-like', () => {
    const textValue = (value: string) => ({ toString: () => value });
    const values = new Map<string, unknown>([
      ['level:parent', 2],
      ['level:row', 4],
      ['parent:row', textValue('doc:grandparent')],
      ['ancestors:row', textValue('doc:root|doc:parent|doc:grandparent')],
    ]);
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);

    const result = computeUnindentMutation({
      rowIds: ['parent', 'row'],
      rowId: 'row',
      docId: 'doc',
      properties: [
        property('level', 'Hierarchy Level'),
        property('parent', 'Parent Identifier'),
        property('ancestors', 'Ancestor Identifiers'),
      ],
    });

    expect(result?.updatedLevels.get('row')).toBe(3);
    expect(result?.updatedParents.get('row')).toBe('doc:parent');
    expect(result?.updatedAncestors.get('row')).toBe('|doc:root|doc:parent|');
  });

  test('repeated unindent walks hierarchy back to root one level at a time', () => {
    const values = new Map<string, unknown>([
      ['level:row', 4],
      ['parent:row', 'doc:level-3'],
      ['ancestors:row', '|doc:level-0|doc:level-1|doc:level-2|doc:level-3|'],
    ]);
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);
    const properties = [
      property('level', 'Hierarchy Level'),
      property('parent', 'Parent Identifier'),
      property('ancestors', 'Ancestor Identifiers'),
    ];
    const levels: number[] = [];

    for (let i = 0; i < 4; i++) {
      const result = computeUnindentMutation({
        rowIds: ['row'],
        rowId: 'row',
        docId: 'doc',
        properties,
      });
      const level = result?.updatedLevels.get('row');
      expect(level).toBeDefined();
      levels.push(level as number);
      values.set('level:row', level);
      values.set('parent:row', result?.updatedParents.get('row') ?? '');
      values.set('ancestors:row', result?.updatedAncestors.get('row') ?? '');
    }

    expect(levels).toEqual([3, 2, 1, 0]);
    expect(
      computeUnindentMutation({
        rowIds: ['row'],
        rowId: 'row',
        docId: 'doc',
        properties,
      })
    ).toBeNull();
  });

  test('repeated unindent falls back to level-only demotion when ancestors are missing', () => {
    const values = new Map<string, unknown>([
      ['level:row', 4],
      ['parent:row', ''],
      ['ancestors:row', ''],
    ]);
    const property = (id: string, name: string) =>
      createHierarchyProperty(values, id, name);
    const properties = [
      property('level', 'Hierarchy Level'),
      property('parent', 'Parent Identifier'),
      property('ancestors', 'Ancestor Identifiers'),
    ];
    const levels: number[] = [];

    for (let i = 0; i < 4; i++) {
      const result = computeUnindentMutation({
        rowIds: ['row'],
        rowId: 'row',
        docId: 'doc',
        properties,
      });
      const level = result?.updatedLevels.get('row');
      expect(level).toBeDefined();
      levels.push(level as number);
      values.set('level:row', level);
      values.set('parent:row', result?.updatedParents.get('row') ?? '');
      values.set('ancestors:row', result?.updatedAncestors.get('row') ?? '');
    }

    expect(levels).toEqual([3, 2, 1, 0]);
  });

  test('initializes focused empty rows through datasource TODO-list conversion', () => {
    let convertedRowId = '';
    const logic = {
      view: {
        manager: {
          dataSource: {
            ensureRowAsTodoList: (rowId: string) => {
              convertedRowId = rowId;
              return true;
            },
          },
        },
      },
    } as unknown as ListViewUILogic;

    expect(
      ListViewUILogic.prototype.ensureTodoListRow.call(logic, 'row-1')
    ).toBe(true);
    expect(convertedRowId).toBe('row-1');
  });

  test('initializes rendered list rows without status-column side effects', () => {
    const convertedRowIds: string[] = [];
    const logic = {
      view: {
        manager: {
          dataSource: {
            ensureRowAsTodoList: (rowId: string) => {
              convertedRowIds.push(rowId);
              return rowId === 'empty-row';
            },
          },
        },
      },
    } as unknown as ListViewUILogic;

    expect(
      ListViewUILogic.prototype.ensureTodoListRows.call(logic, [
        'text-row',
        'empty-row',
      ])
    ).toBe(true);
    expect(convertedRowIds).toEqual(['text-row', 'empty-row']);
  });

  test('list renderer initializes rows before rendering title cells', () => {
    expect(getListRendererSource()).toMatch(/ensureTodoListRows/);
    expect(getListRendererSource().indexOf('ensureTodoListRows')).toBeLessThan(
      getListRendererSource().indexOf('renderCell')
    );
  });

  test('renders rows with stable row-id keys for insert reconciliation', () => {
    // Verifies the filtered row list (Story 2.7 AC5's overdue-hide filter)
    // is actually wired in as `repeat()`'s own first argument, immediately
    // followed by the `row.rowId` key function — not just that both
    // snippets exist somewhere in the file. `Function.prototype.toString()`
    // reflects the vite/esbuild-transformed source: the re-exported
    // `repeat` call becomes `(0, mod.repeat)(...)` (hence `repeat\)\(`,
    // matching the original test's own pattern), arrow params get
    // parenthesized, and quotes get normalized to double — an interposed
    // comment block is still allowed between `repeat(` and the filter.
    expect(getListRendererSource()).toMatch(
      /repeat\)\(\s*(?:\/\/[^\n]*\n\s*)*this\.view\.rows\$\.value\.filter\(\s*\(?row\)? => this\.getRowDueDateState\(row\.rowId\) !== ["']hide["']\s*\),\s*\(?row\)? => row\.rowId,/
    );
  });

  describe('Story 2.8: row drag-to-reorder and drag-to-reindent', () => {
    const attached: Element[] = [];
    afterEach(() => {
      for (const el of attached.splice(0)) {
        el.remove();
      }
    });

    test("drag handle is gated on todo-capability and readonly, matching the row's other todo-only actions", () => {
      const renderer = new ListViewRenderer();
      const render = (
        getTaskStatusColumn: (() => unknown) | undefined,
        readonly: boolean
      ) => {
        Object.assign(renderer, {
          logic: {
            view: {
              manager: { dataSource: { getTaskStatusColumn } },
              readonly$: { value: readonly },
            },
          },
        });
        return (
          renderer as unknown as {
            renderDragHandle: (rowId: string) => unknown;
          }
        ).renderDragHandle('row-1');
      };

      // Plain, non-todo database — no `getTaskStatusColumn` method at all.
      expect(render(undefined, false)).toBe(nothing);
      // Todo-capable, but no status column actually configured yet.
      expect(render(() => undefined, false)).toBe(nothing);
      // Todo-capable and configured, but the view is read-only.
      expect(render(() => ({ id: 'status' }), true)).toBe(nothing);
      // Todo-capable, configured, writable — handle renders.
      expect(render(() => ({ id: 'status' }), false)).not.toBe(nothing);
    });

    const hierarchyProperty = (levels: Map<string, number>) => ({
      name$: { value: 'Hierarchy Level' },
      cellGetOrCreate: (rowId: string) => ({
        jsonValue$: { value: levels.get(rowId) ?? 0 },
      }),
    });

    const createRow = (
      rowId: string,
      rect: { top: number; bottom: number },
      titleLeft: number
    ) => {
      const row = document.createElement('div');
      row.className = 'affine-data-view-list-row';
      row.dataset.rowId = rowId;
      row.getBoundingClientRect = () =>
        ({
          top: rect.top,
          bottom: rect.bottom,
          left: 0,
          right: 400,
          width: 400,
          height: rect.bottom - rect.top,
        }) as DOMRect;
      const title = document.createElement('div');
      title.className = 'affine-data-view-list-title';
      title.getBoundingClientRect = () =>
        ({
          top: rect.top,
          bottom: rect.bottom,
          left: titleLeft,
          right: titleLeft + 200,
          width: 200,
          height: rect.bottom - rect.top,
        }) as DOMRect;
      row.append(title);
      return row;
    };

    const createHost = (rows: HTMLElement[]) => {
      const list = document.createElement('div');
      list.className = 'affine-data-view-list';
      list.getBoundingClientRect = () =>
        ({
          top: 0,
          bottom: rows.length * 30,
          left: 0,
          right: 400,
          width: 400,
          height: rows.length * 30,
        }) as DOMRect;
      for (const row of rows) {
        list.append(row);
      }
      const host = document.createElement('div');
      host.append(list);
      document.body.append(host);
      attached.push(host);
      return host;
    };

    test('getInsertPosition: zero horizontal offset keeps the moved row a sibling of the reference row', () => {
      const rowA = createRow('row-a', { top: 0, bottom: 30 }, 20);
      const host = createHost([rowA]);
      const levels = new Map([['row-a', 0]]);
      const logic = {
        view: { propertiesRaw$: { value: [hierarchyProperty(levels)] } },
        ui$: { value: host },
      } as unknown as ListViewUILogic;
      const controller = new ListDragController(logic);

      // Upper half of row-a (before=true), no horizontal offset from
      // row-a's own title start (x === titleLeft).
      const result = controller.getInsertPosition({
        clientX: 20,
        clientY: 5,
        target: rowA,
      } as unknown as MouseEvent);

      expect(result?.position).toEqual({ id: 'row-a', before: true });
      expect(result?.level).toBe(0);
    });

    test("getInsertPosition: dragging right past the 24px threshold nests as the reference row's child, clamped at maxLevel", () => {
      const rowA = createRow('row-a', { top: 0, bottom: 30 }, 20);
      const host = createHost([rowA]);
      const levels = new Map([['row-a', 0]]);
      const logic = {
        view: { propertiesRaw$: { value: [hierarchyProperty(levels)] } },
        ui$: { value: host },
      } as unknown as ListViewUILogic;
      const controller = new ListDragController(logic);

      // Lower half (before=false / after row-a) so maxLevel = refLevel + 1.
      const oneLevelRight = controller.getInsertPosition({
        clientX: 20 + 24,
        clientY: 25,
        target: rowA,
      } as unknown as MouseEvent);
      expect(oneLevelRight?.position).toEqual({ id: 'row-a', before: false });
      expect(oneLevelRight?.level).toBe(1);

      // Two levels' worth of rightward drag still clamps at maxLevel (1),
      // not 2 — can't become a grandchild of a row with no children yet.
      const twoLevelsRight = controller.getInsertPosition({
        clientX: 20 + 48,
        clientY: 25,
        target: rowA,
      } as unknown as MouseEvent);
      expect(twoLevelsRight?.level).toBe(1);
    });

    test('getInsertPosition: dragging left of the reference row promotes it shallower, clamped at 0', () => {
      const rowB = createRow('row-b', { top: 30, bottom: 60 }, 44);
      const host = createHost([rowB]);
      const levels = new Map([['row-b', 1]]);
      const logic = {
        view: { propertiesRaw$: { value: [hierarchyProperty(levels)] } },
        ui$: { value: host },
      } as unknown as ListViewUILogic;
      const controller = new ListDragController(logic);

      const farLeft = controller.getInsertPosition({
        clientX: 44 - 200,
        clientY: 35,
        target: rowB,
      } as unknown as MouseEvent);
      expect(farLeft?.level).toBe(0);
    });

    test('a completed drop calls setPendingHierarchyLevel then row.move with the resolved position/level', () => {
      const rowA = createRow('row-a', { top: 0, bottom: 30 }, 20);
      const rowB = createRow('row-b', { top: 30, bottom: 60 }, 20);
      const host = createHost([rowA, rowB]);
      const levels = new Map([
        ['row-a', 0],
        ['row-b', 0],
      ]);
      const calls: string[] = [];
      const dataSource = {
        setPendingHierarchyLevel: (rowId: string, level: number) => {
          calls.push(`setPendingHierarchyLevel(${rowId}, ${level})`);
        },
      };
      const rowGetOrCreate = (rowId: string) => ({
        move: (position: unknown) => {
          calls.push(`move(${rowId}, ${JSON.stringify(position)})`);
        },
      });
      const logic = {
        view: {
          propertiesRaw$: { value: [hierarchyProperty(levels)] },
          manager: { dataSource },
          rowGetOrCreate,
          readonly$: { value: false },
        },
        ui$: { value: host },
        root: { config: {} },
      } as unknown as ListViewUILogic;
      const controller = new ListDragController(logic);

      controller.dragStart(
        rowA,
        new PointerEvent('pointerdown', { clientX: 20, clientY: 5 })
      );
      // Drag row-a to become a child of row-b (lower half, one level right
      // of row-b's own title start), dispatched on row-b so the window
      // `pointermove` listener sees `event.target === rowB`.
      rowB.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 44,
          clientY: 55,
          bubbles: true,
        })
      );
      window.dispatchEvent(new PointerEvent('pointerup'));

      expect(calls).toEqual([
        'setPendingHierarchyLevel(row-a, 1)',
        'move(row-a, {"id":"row-b","before":false})',
      ]);
    });

    test('cancelling with Escape commits nothing', () => {
      const rowA = createRow('row-a', { top: 0, bottom: 30 }, 20);
      const rowB = createRow('row-b', { top: 30, bottom: 60 }, 20);
      const host = createHost([rowA, rowB]);
      const levels = new Map([
        ['row-a', 0],
        ['row-b', 0],
      ]);
      const calls: string[] = [];
      const dataSource = {
        setPendingHierarchyLevel: (rowId: string, level: number) => {
          calls.push(`setPendingHierarchyLevel(${rowId}, ${level})`);
        },
      };
      const rowGetOrCreate = (rowId: string) => ({
        move: (position: unknown) => {
          calls.push(`move(${rowId}, ${JSON.stringify(position)})`);
        },
      });
      const logic = {
        view: {
          propertiesRaw$: { value: [hierarchyProperty(levels)] },
          manager: { dataSource },
          rowGetOrCreate,
          readonly$: { value: false },
        },
        ui$: { value: host },
        root: { config: {} },
      } as unknown as ListViewUILogic;
      const controller = new ListDragController(logic);

      controller.dragStart(
        rowA,
        new PointerEvent('pointerdown', { clientX: 20, clientY: 5 })
      );
      rowB.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 44,
          clientY: 55,
          bubbles: true,
        })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      window.dispatchEvent(new PointerEvent('pointerup'));

      expect(calls).toEqual([]);
    });
  });
});
