import {
  FeatureFlagService,
  VirtualKeyboardProvider,
} from '@blocksuite/affine/shared/services';
import { TextSelection } from '@blocksuite/std';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import { createStubVirtualKeyboardExtension } from './utils.js';

// Phase 4 (MOBILE-15, Bug B, D-09): proves `affine-keyboard-toolbar`'s own
// host `bottom` style reactively tracks the already-wired
// `keyboard.height$`/`visible$`/`appTabSafeArea$` signal chain (bridged
// from `app.tsx`'s existing `visualViewport` listener via
// `KeyboardToolbarExtension`), instead of relying solely on native
// `100dvh` recompute — confirmed live to be fragile on iOS Safari
// (scrolling to force a reflow was needed to see the toolbar reposition).
// Uses `createStubVirtualKeyboardExtension`'s settable `visible$`/
// `height$`/`appTabSafeArea$` signals to simulate the keyboard opening
// without a real `visualViewport` event.
describe('keyboard-toolbar bottom position touch reachability (Phase 4, MOBILE-15)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
    ]);
    return cleanup;
  });

  test("the toolbar's host bottom style reactively tracks keyboard.height$/visible$/appTabSafeArea$", async () => {
    // `AffineKeyboardToolbarWidget.render()` gates on this flag (default
    // `false`); enable it so the widget actually mounts
    // `affine-keyboard-toolbar` in the DOM for this test.
    doc.get(FeatureFlagService).setFlag('enable_mobile_keyboard_toolbar', true);

    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);

    const selection = editor.std.selection.create(TextSelection, {
      from: { blockId: paragraphId, index: 0, length: 0 },
      to: null,
    });
    editor.std.selection.setGroup('note', [selection]);
    // Focus the editor so `AffineKeyboardToolbarWidget`'s own
    // `std.event.active$`-gated render actually mounts the toolbar,
    // matching `note-ref-block.ts`'s own established use of this public
    // setter.
    editor.std.event.active = true;
    await wait();

    const toolbar = document.querySelector(
      'affine-keyboard-toolbar'
    ) as HTMLElement | null;
    expect(toolbar).toBeTruthy();

    const keyboard = editor.std.get(VirtualKeyboardProvider) as unknown as {
      visible$: { value: boolean };
      height$: { value: number };
      appTabSafeArea$: { value: string };
    };

    // (1) keyboard hidden: bottom should equal the app-tab safe area.
    keyboard.visible$.value = false;
    await wait();
    expect(toolbar!.style.bottom).toBe(keyboard.appTabSafeArea$.value);

    // (2) keyboard shown with a live height: bottom should update
    // reactively to track the height, proving the binding is live, not a
    // one-time read.
    keyboard.visible$.value = true;
    keyboard.height$.value = 300;
    await wait();
    expect(toolbar!.style.bottom).toBe('300px');
  });
});
