import type { VirtualKeyboardProvider } from '@affine/core/mobile/modules/virtual-keyboard';

/**
 * Derives `VirtualKeyboardService.visible$`/`height$` from `visualViewport`
 * `resize`/`scroll` events on the web/PWA mobile app (`packages/frontend/apps/mobile`).
 *
 * Extracted out of `app.tsx` so this event-derivation logic can be unit
 * tested in isolation against synthetic `resize`/`scroll` sequences modeled
 * directly on real on-device captures (see
 * `.planning/debug/keyboard-scroll-noise.md` and
 * `src/__tests__/virtual-keyboard-provider.unit.spec.ts`), without pulling in
 * `app.tsx`'s module-level side effects (worker/store bootstrapping, etc).
 *
 * Only `resize` events are used to compute `visible`/`height`. `scroll`
 * fires for visual-viewport *position* changes (content scroll,
 * focus-follow-scroll, pinch-pan) — never for *size* changes; per the
 * VisualViewport spec, a keyboard show/hide is a dimension change and always
 * fires `resize`. Feeding `scroll` events into this computation was
 * confirmed on-device to produce internally-contradictory readings (a stale
 * `windowInnerHeight` paired with an already-updated `visualViewport.height`,
 * or a spurious nonzero `offsetTop` with no real keyboard change — including
 * negative computed heights), which — because the result is written straight
 * into a CSS var that reserves in-flow layout space — could itself trigger
 * more `scroll` events, compounding into a runaway feedback loop. See
 * `.planning/debug/keyboard-scroll-noise.md` for the two real-device
 * captures this diagnosis is based on.
 *
 * The `[MobileDebugLog] visualViewport-event` logging is deliberately kept
 * for both event types (unchanged) — it is the exact instrumentation that
 * produced those captures, and remains valuable for future on-device
 * diagnosis.
 */
export function createVisualViewportVirtualKeyboardProvider(): VirtualKeyboardProvider {
  return {
    onChange: callback => {
      if (!visualViewport) {
        console.warn('visualViewport is not supported');
        return () => {};
      }

      const listener = (event: Event) => {
        if (!visualViewport) return;
        const windowHeight = window.innerHeight;

        /**
         * ┌───────────────┐ - window top
         * │               │
         * │               │
         * │               │
         * │               │
         * │               │
         * └───────────────┘ - keyboard top        --
         * │               │                       │ keyboard height in layout viewport
         * └───────────────┘ - page(html) bottom   --
         * │               │                       │ visualViewport.offsetTop
         * └───────────────┘ - window bottom       --
         */
        console.debug('[MobileDebugLog] visualViewport-event', {
          type: event.type,
          timestampMs: Date.now(),
          windowInnerHeight: window.innerHeight,
          visualViewportHeight: visualViewport.height,
          visualViewportWidth: visualViewport.width,
          visualViewportOffsetTop: visualViewport.offsetTop,
          visualViewportOffsetLeft: visualViewport.offsetLeft,
          visualViewportScale: visualViewport.scale,
          computedVisible: window.innerHeight - visualViewport.height > 0,
          computedHeight:
            windowHeight - visualViewport.height - visualViewport.offsetTop,
        });

        // `scroll` never carries a legitimate keyboard-size signal, only
        // `resize` does — see module doc comment. Do not feed `scroll` into
        // the visible/height computation.
        if (event.type !== 'resize') return;

        callback({
          visible: window.innerHeight - visualViewport.height > 0,
          height:
            windowHeight - visualViewport.height - visualViewport.offsetTop,
        });
      };

      visualViewport.addEventListener('resize', listener);
      visualViewport.addEventListener('scroll', listener);
      return () => {
        visualViewport?.removeEventListener('resize', listener);
        visualViewport?.removeEventListener('scroll', listener);
      };
    },
  };
}
