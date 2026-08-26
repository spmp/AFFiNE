import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import {
  defaultKeyboardToolbarConfig,
  type KeyboardToolPanelConfig,
  type KeyboardToolPanelGroup,
} from '@blocksuite/affine-widget-keyboard-toolbar';
import { viewPresets } from '@blocksuite/data-view/view-presets';
import { type BlockComponent, TextSelection } from '@blocksuite/std';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import { createStubVirtualKeyboardExtension } from './utils.js';

// Story 2.12/Phase 2 (MOBILE-06, MOBILE-10): now that
// `utils/setup.ts`'s `createEditor` genuinely composes the mobile
// (`mobile-page`/`mobile-edgeless`) view-extension scope under
// `IS_MOBILE` (this plan's Task 1 fix), this file proves — for real, via a
// touch-emulated context — that the keyboard-toolbar's "+" Database tool
// group (`databaseToolGroup`, `keyboard-toolbar/src/config.ts`) is the true
// mobile reachability path for Calendar view (this file) and Journal Todo
// (added in Task 3), since the slash-menu widget itself never mounts on
// mobile (`SlashMenuViewExtension.setup`'s intentional mobile-scope early
// return — see `slash-menu-touch.spec.ts`'s corrected assertion).
function findDatabaseGroup(): KeyboardToolPanelGroup {
  const moreToolPanel = defaultKeyboardToolbarConfig.items.find(
    (item): item is KeyboardToolPanelConfig => 'groups' in item
  );
  expect(moreToolPanel).toBeTruthy();

  const databaseGroup = moreToolPanel?.groups.find(
    (group): group is KeyboardToolPanelGroup =>
      typeof group !== 'function' && group.name === 'Database'
  );
  expect(databaseGroup).toBeTruthy();

  return databaseGroup!;
}

describe('keyboard-toolbar database tool group touch reachability (Phase 2, MOBILE-06/MOBILE-10)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
    ]);
    return cleanup;
  });

  async function selectFreshParagraph() {
    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);
    const model = doc.getModelById(paragraphId)!;

    const selection = editor.std.selection.create(TextSelection, {
      from: { blockId: paragraphId, index: 0, length: 0 },
      to: null,
    });
    editor.std.selection.setGroup('note', [selection]);
    await wait();

    return { paragraphId, model };
  }

  // Tracer: proves the harness fix (Task 1) genuinely composes mobile scope
  // AND that the keyboard-toolbar registration mechanism this whole phase
  // relies on for MOBILE-06/09 actually works end-to-end.
  test('the keyboard-toolbar\'s "Calendar view" item inserts a calendar-view database block', async () => {
    await selectFreshParagraph();

    const databaseGroup = findDatabaseGroup();
    const calendarItem = databaseGroup.items.find(
      item => item.name === 'Calendar view'
    );
    expect(calendarItem).toBeTruthy();

    const databaseBlocksBefore = doc.getBlocksByFlavour('affine:database');
    expect(databaseBlocksBefore.length).toBe(0);

    await calendarItem!.action?.({
      std: editor.std,
      rootComponent: {} as BlockComponent,
      closeToolPanel: () => {},
    });
    await wait();

    const databaseBlocksAfter = doc.getBlocksByFlavour('affine:database');
    expect(databaseBlocksAfter.length).toBe(1);
    const databaseModel = databaseBlocksAfter[0]!.model as DatabaseBlockModel;
    const seededView = databaseModel.props.views[0] as unknown as {
      mode: string;
    };
    expect(seededView.mode).toBe(viewPresets.calendarViewMeta.type);
  });
});
