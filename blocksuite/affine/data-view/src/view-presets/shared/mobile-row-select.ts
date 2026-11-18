/**
 * Mobile row selection (F-11): there is no Ctrl+C on a phone, so rows are
 * selected by touch and copied from a bar.
 *
 * - Long-press a row (hold still for `LONG_PRESS_MS`) to start selecting,
 *   with that row selected.
 * - While selecting, taps on rows add or remove them; they don't start
 *   editing.
 * - A bar at the bottom shows how many rows are selected, with Copy (hold it
 *   to copy as plain text), Select all and Done.
 */

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const BAR_TAG = 'affine-mobile-row-select-bar';

export interface MobileRowSelectTarget {
  /** The element to listen on (the view). */
  host: HTMLElement;
  /** The row an event happened in, if any. */
  rowOf(target: EventTarget | null): string | undefined;
  /** All rows, in the order shown. */
  rowIds(): string[];
  selected(): string[];
  setSelected(rowIds: string[]): void;
  copy(rowIds: string[]): void;
  /** Plain text only (pasted into AFFiNE, it goes through Markdown). */
  copyText(rowIds: string[]): void;
}

function createBar(actions: {
  copy(): void;
  copyText(): void;
  selectAll(): void;
  done(): void;
}) {
  const bar = document.createElement(BAR_TAG);
  Object.assign(bar.style, {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: '12px',
    background: 'var(--affine-background-overlay-panel-color, #fff)',
    boxShadow: 'var(--affine-shadow-2, 0 4px 16px rgba(0,0,0,0.15))',
    fontSize: '15px',
    color: 'var(--affine-text-primary-color, #000)',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  const count = document.createElement('span');
  bar.append(count);
  // Copy: a tap copies (a database when pasted into a page); a long-press
  // copies as plain text. One button, as the bar has no room for two.
  for (const [label, action, onLongPress] of [
    ['Copy', actions.copy, actions.copyText],
    ['Select all', actions.selectAll, undefined],
    ['Done', actions.done, undefined],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (onLongPress) button.title = 'Hold to copy as text';
    Object.assign(button.style, {
      border: 'none',
      background: 'none',
      padding: '4px 6px',
      fontSize: '15px',
      fontWeight: '600',
      color: 'var(--affine-primary-color, #1e96eb)',
      webkitUserSelect: 'none',
      userSelect: 'none',
      webkitTouchCallout: 'none',
    } as Partial<CSSStyleDeclaration>);
    // The clipboard can only be written in the release itself: iOS rejects
    // a write from the hold timer (NotAllowedError, seen live 2026-11-17).
    // So the timer only relabels the button, and the click that ends the
    // press decides: held long enough, copy as text; otherwise copy.
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    const reset = () => {
      clearTimeout(holdTimer);
      holdTimer = undefined;
      held = false;
      button.textContent = label;
    };
    // pointerdown would take focus (and the selection) away first
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      reset();
      if (!onLongPress) return;
      holdTimer = setTimeout(() => {
        holdTimer = undefined;
        held = true;
        button.textContent = 'Copy as text';
      }, LONG_PRESS_MS);
    });
    // not pointerleave: iOS sends it with every release
    button.addEventListener('pointercancel', reset);
    button.addEventListener('contextmenu', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const asText = held && onLongPress;
      reset();
      if (asText) {
        onLongPress();
      } else {
        action();
      }
    });
    bar.append(button);
  }
  return {
    element: bar,
    setCount(n: number) {
      count.textContent = `${n} selected`;
    },
  };
}

/** Starts listening; returns a function that stops (and ends selecting). */
export function installMobileRowSelect(
  target: MobileRowSelectTarget
): () => void {
  let selecting = false;
  let press: {
    rowId: string;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  // a click toggles a row only if its own pointerdown happened while
  // selecting, so the click ending the long-press itself is ignored
  let tapStarted = false;
  let bar: ReturnType<typeof createBar> | null = null;

  const update = () => bar?.setCount(target.selected().length);

  const blurInside = () => {
    getSelection()?.removeAllRanges();
    const active = document.activeElement;
    if (active instanceof HTMLElement && target.host.contains(active)) {
      active.blur();
    }
  };

  const stop = () => {
    selecting = false;
    target.setSelected([]);
    bar?.element.remove();
    bar = null;
  };

  const start = (rowId: string) => {
    selecting = true;
    tapStarted = false;
    blurInside();
    target.setSelected([rowId]);
    bar ??= createBar({
      copy: () => {
        const rows = target.selected();
        if (rows.length) target.copy(rows);
      },
      copyText: () => {
        const rows = target.selected();
        if (rows.length) target.copyText(rows);
      },
      selectAll: () => {
        target.setSelected(target.rowIds());
        update();
      },
      done: stop,
    });
    document.body.append(bar.element);
    update();
  };

  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    const rowId = target.rowOf(event.target);
    if (!rowId) return;
    if (selecting) {
      // a tap toggles the row (on click); don't start editing or dragging
      event.preventDefault();
      event.stopPropagation();
      tapStarted = true;
      return;
    }
    cancelPress();
    press = {
      rowId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        const id = press?.rowId;
        press = null;
        if (id) start(id);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!press) return;
    if (
      Math.abs(event.clientX - press.x) > MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - press.y) > MOVE_TOLERANCE_PX
    ) {
      cancelPress();
    }
  };

  const onClick = (event: MouseEvent) => {
    if (!selecting) return;
    const rowId = target.rowOf(event.target);
    if (!rowId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tapStarted) return;
    tapStarted = false;
    const rows = target.selected();
    target.setSelected(
      rows.includes(rowId)
        ? rows.filter(id => id !== rowId)
        : target.rowIds().filter(id => id === rowId || rows.includes(id))
    );
    blurInside();
    update();
  };

  const host = target.host;
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('pointermove', onPointerMove, true);
  host.addEventListener('pointerup', cancelPress, true);
  host.addEventListener('pointercancel', cancelPress, true);
  host.addEventListener('click', onClick, true);
  return () => {
    cancelPress();
    host.removeEventListener('pointerdown', onPointerDown, true);
    host.removeEventListener('pointermove', onPointerMove, true);
    host.removeEventListener('pointerup', cancelPress, true);
    host.removeEventListener('pointercancel', cancelPress, true);
    host.removeEventListener('click', onClick, true);
    if (selecting) stop();
  };
}
