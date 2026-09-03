import { FeatureFlagService } from '@blocksuite/affine/shared/services';
import { TextSelection } from '@blocksuite/std';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { addNote } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';
import { createStubVirtualKeyboardExtension } from './utils.js';

// Phase 4 (MOBILE-15, Bug B, D-09): proves `AffineKeyboardToolbar`'s host
// `style.bottom` reactively tracks the stub `VirtualKeyboardProvider`'s
// `visible$`/`height$`/`appTabSafeArea$` signals -- the exact same signal
// chain the real app bridges from `app.tsx`'s existing `visualViewport`
// listener via `KeyboardToolbarExtension` (packages/frontend/core) -- with
// zero new listener code and zero changes to styles.ts's static fallback.
describe('keyboard-toolbar bottom position touch reachability (Phase 4, MOBILE-15)', () => {
  beforeEach(async () => {
    const cleanup = await setupEditor('page', [
      createStubVirtualKeyboardExtension(),
    ]);
    return cleanup;
  });

  async function focusFreshParagraph() {
    // The widget only renders when `enable_mobile_keyboard_toolbar` is on
    // (default false, matching `enableMobileDatabaseEditing`'s established
    // opt-in pattern in this same directory's utils.ts) and the dispatcher
    // is active for this scope (`std.event.active$`, mirrored by the
    // widget's own `_show$`).
    doc.get(FeatureFlagService).setFlag('enable_mobile_keyboard_toolbar', true);

    const noteId = addNote(doc);
    const paragraphId = doc.addBlock('affine:paragraph', {}, noteId);

    const selection = editor.std.selection.create(TextSelection, {
      from: { blockId: paragraphId, index: 0, length: 0 },
      to: null,
    });
    editor.std.selection.setGroup('note', [selection]);
    editor.std.event.active = true;
    await wait();

    return { paragraphId };
  }

  test('host bottom style reactively tracks keyboard.height$/visible$/appTabSafeArea$', async () => {
    await focusFreshParagraph();

    const toolbar = document.querySelector<HTMLElement>(
      'affine-keyboard-toolbar'
    );
    expect(toolbar).toBeTruthy();

    const keyboard = (
      toolbar as unknown as {
        keyboard: {
          visible$: { value: boolean };
          height$: { value: number };
          appTabSafeArea$: { value: string };
        };
      }
    ).keyboard;

    // (1) keyboard hidden: bottom falls back to the stub's appTabSafeArea$.
    keyboard.visible$.value = false;
    await wait();
    expect(toolbar!.style.bottom).toBe(keyboard.appTabSafeArea$.value);

    // (2) keyboard visible with a live height: bottom updates reactively,
    // proving this is a live binding, not a one-time read.
    keyboard.visible$.value = true;
    keyboard.height$.value = 300;
    await wait();
    expect(toolbar!.style.bottom).toBe('300px');
  });
});
