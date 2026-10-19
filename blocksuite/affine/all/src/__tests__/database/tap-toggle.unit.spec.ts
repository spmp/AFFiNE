import { createTapToggle } from '@blocksuite/affine-block-database';
import { describe, expect, it, vi } from 'vitest';

// 999.3: on iOS with the keyboard open, a completed tap on the title
// checkbox (pointerdown -> pointerup -> touchend, no cancel) often gets NO
// click event at all, so a click-only handler never toggled. Toggle on the
// completed touch/pen pointerup instead, and ignore the click iOS may still
// deliver afterwards so the checkbox never double-toggles.
function setup() {
  let now = 1000;
  const onToggle = vi.fn();
  const tap = createTapToggle(onToggle, () => now);
  const advance = (ms: number) => (now += ms);
  const ev = (pointerType: string, x = 40, y = 180, pointerId = 1) =>
    ({ pointerType, clientX: x, clientY: y, pointerId }) as PointerEvent;
  return { onToggle, tap, advance, ev };
}

describe('createTapToggle', () => {
  it('toggles on a completed touch tap even when no click follows (iOS, keyboard open)', () => {
    const { onToggle, tap, ev } = setup();
    tap.onPointerDown(ev('touch'));
    tap.onPointerUp(ev('touch', 41, 181));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('ignores the click iOS delivers after a handled touch tap (no double toggle)', () => {
    const { onToggle, tap, ev, advance } = setup();
    tap.onPointerDown(ev('touch'));
    tap.onPointerUp(ev('touch'));
    advance(80);
    tap.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('still toggles on a later, separate click', () => {
    const { onToggle, tap, ev, advance } = setup();
    tap.onPointerDown(ev('touch'));
    tap.onPointerUp(ev('touch'));
    advance(1000);
    tap.onClick();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('does not toggle on pointerup for a drag (moved > 10px) or without a matching pointerdown', () => {
    const { onToggle, tap, ev } = setup();
    tap.onPointerDown(ev('touch', 40, 180));
    tap.onPointerUp(ev('touch', 40, 200));
    tap.onPointerUp(ev('touch'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('leaves mouse input to the click handler (desktop unchanged)', () => {
    const { onToggle, tap, ev } = setup();
    tap.onPointerDown(ev('mouse'));
    tap.onPointerUp(ev('mouse'));
    expect(onToggle).not.toHaveBeenCalled();
    tap.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('handles pen like touch', () => {
    const { onToggle, tap, ev } = setup();
    tap.onPointerDown(ev('pen'));
    tap.onPointerUp(ev('pen'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('forgets the pointerdown after a pointercancel', () => {
    const { onToggle, tap, ev } = setup();
    tap.onPointerDown(ev('touch'));
    tap.onPointerCancel();
    tap.onPointerUp(ev('touch'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
