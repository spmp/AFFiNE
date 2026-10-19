/**
 * 999.3: tap handling for the database title's task checkbox.
 *
 * On iOS with the keyboard open, a completed tap on the checkbox
 * (`pointerdown -> pointerup -> touchend`, no cancel, recorded on device)
 * often produces NO `click` event at all, so a click-only handler never
 * toggled -- ticking took 4-24 taps. Toggle on a completed touch/pen
 * `pointerup` (same pointer, moved less than `TAP_SLOP_PX`), and ignore a
 * `click` arriving within `CLICK_DEDUPE_MS` of that, since iOS sometimes
 * does still deliver it. Mouse, keyboard and programmatic clicks keep
 * going through `onClick` unchanged.
 */
const TAP_SLOP_PX = 10;
const CLICK_DEDUPE_MS = 600;

export interface TapToggleHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: () => void;
  onClick: () => void;
}

export function createTapToggle(
  onToggle: () => void,
  now: () => number = () => performance.now()
): TapToggleHandlers {
  let down: { pointerId: number; x: number; y: number } | null = null;
  let lastTapToggleAt = -Infinity;

  const isTouchLike = (event: PointerEvent) =>
    event.pointerType === 'touch' || event.pointerType === 'pen';

  return {
    onPointerDown: event => {
      down = isTouchLike(event)
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    },
    onPointerUp: event => {
      const start = down;
      down = null;
      if (!start || !isTouchLike(event) || event.pointerId !== start.pointerId)
        return;
      if (
        Math.abs(event.clientX - start.x) > TAP_SLOP_PX ||
        Math.abs(event.clientY - start.y) > TAP_SLOP_PX
      )
        return;
      lastTapToggleAt = now();
      onToggle();
    },
    onPointerCancel: () => {
      down = null;
    },
    onClick: () => {
      if (now() - lastTapToggleAt < CLICK_DEDUPE_MS) return;
      onToggle();
    },
  };
}
