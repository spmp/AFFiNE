/**
 * Debug-only tripwires for intermittent mobile bugs that are gone by the
 * time anyone looks: each writes the state at the moment it happens to the
 * mobile debug log (`console.debug(MARKER, ...)`, see `mobile-debug-log.ts`;
 * uploaded only when the server enables debug-log collection).
 *
 * - `enter-newline` (F-17, F-18): Enter inserts a newline in a list item or
 *   heading instead of a new item / paragraph. A handled Enter is cancelled
 *   on keydown, so an `insertParagraph` / `insertLineBreak` reaching one of
 *   those blocks means the editor's keymap didn't run. Logs whether each
 *   editor host's event dispatcher was active, and which one has the caret.
 * - `drag-no-drop-line` (F-09): a List view row (Journal Todo) is being
 *   dragged and the drop line has been missing for a while.
 */

import { MARKER } from './mobile-debug-log';

type HostLike = HTMLElement & {
  std?: {
    event?: { active?: boolean };
    store?: {
      id?: string;
      getBlock?: (id: string) => {
        model?: { flavour?: string; props?: { type?: unknown } };
      } | null;
    };
  };
};

const SPLIT_FLAVOURS = new Set(['affine:list']);
const HEADING = /^h[1-6]$/;

function caretElement(): Element | null {
  const node = document.getSelection()?.anchorNode;
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

export function installEnterNewlineTripwire(): () => void {
  let lastEnter: { at: number; event: KeyboardEvent } | null = null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      lastEnter = { at: performance.now(), event };
    }
  };

  const onBeforeInput = (event: InputEvent) => {
    if (
      event.inputType !== 'insertParagraph' &&
      event.inputType !== 'insertLineBreak'
    ) {
      return;
    }
    const el = caretElement();
    const blockEl = el?.closest<HTMLElement>('[data-block-id]');
    // Database cells and rows have their own Enter handling.
    if (!blockEl || el?.closest('affine-database, affine-data-view-list')) {
      return;
    }
    const caretHost = el?.closest('editor-host') as HostLike | null;
    const blockId = blockEl.dataset.blockId ?? '';
    const model = caretHost?.std?.store?.getBlock?.(blockId)?.model;
    const flavour = model?.flavour ?? blockEl.tagName.toLowerCase();
    const type =
      typeof model?.props?.type === 'string' ? model.props.type : undefined;
    if (!SPLIT_FLAVOURS.has(flavour) && !(type && HEADING.test(type))) {
      return;
    }
    const recent =
      lastEnter && performance.now() - lastEnter.at < 500 ? lastEnter : null;
    const hosts = Array.from(
      document.querySelectorAll<HostLike>('editor-host')
    ).map(host => ({
      doc: host.std?.store?.id,
      active: host.std?.event?.active ?? null,
      hasCaret: host === caretHost,
    }));
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    console.debug(
      MARKER,
      'enter-newline',
      JSON.stringify({
        inputType: event.inputType,
        block: { flavour, type, id: blockId },
        inNoteRef: !!el?.closest('affine-note-ref'),
        keydownSeen: !!recent,
        keydownPrevented: recent ? recent.event.defaultPrevented : null,
        hosts,
        activeElement: active
          ? `${active.tagName.toLowerCase()}.${String(active.className).slice(0, 40)}`
          : null,
      })
    );
  };

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('beforeinput', onBeforeInput, true);
  };
}

const DRAG_HANDLE = '.affine-data-view-list-drag-handle';
const DROP_LINE = 'body > [data-is-drop-preview="true"]';
const MOVE_THRESHOLD_PX = 20;
const MISSING_FOR_MS = 300;

export function installDragIndicatorTripwire(): () => void {
  let drag: {
    startY: number;
    rowId?: string;
    moved: boolean;
    missingSince: number | null;
    logged: boolean;
    list: Element | null;
  } | null = null;

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>(DRAG_HANDLE);
    if (!handle) return;
    drag = {
      startY: event.clientY,
      rowId: handle.closest<HTMLElement>('[data-row-id]')?.dataset.rowId,
      moved: false,
      missingSince: null,
      logged: false,
      list: handle.closest('.affine-data-view-list'),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.logged) return;
    if (Math.abs(event.clientY - drag.startY) >= MOVE_THRESHOLD_PX) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    if (document.querySelector(DROP_LINE)) {
      drag.missingSince = null;
      return;
    }
    const now = performance.now();
    drag.missingSince ??= now;
    if (now - drag.missingSince < MISSING_FOR_MS) return;
    drag.logged = true;
    const rect = drag.list?.getBoundingClientRect();
    console.debug(
      MARKER,
      'drag-no-drop-line',
      JSON.stringify({
        rowId: drag.rowId,
        pointerY: Math.round(event.clientY),
        startY: Math.round(drag.startY),
        list: rect
          ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
          : null,
        rows: drag.list?.querySelectorAll('[data-row-id]').length ?? null,
        ghost: !!document.querySelector(
          'body > div.with-data-view-css-variable'
        ),
        scrollY: Math.round(window.scrollY),
      })
    );
  };

  const onPointerEnd = () => {
    drag = null;
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerEnd, true);
    document.removeEventListener('pointercancel', onPointerEnd, true);
  };
}
