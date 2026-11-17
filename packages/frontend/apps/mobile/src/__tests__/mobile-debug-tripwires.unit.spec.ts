/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MARKER } from '../mobile-debug-log';
import {
  installDragIndicatorTripwire,
  installEnterNewlineTripwire,
} from '../mobile-debug-tripwires';

// F-17 / F-18 / F-09 (2026-11-17): intermittent on the phone and gone by
// the time anyone looks. These write the state at the moment it happens to
// the mobile debug log.

function setSelectionIn(node: Node) {
  const range = document.createRange();
  range.setStart(node, 0);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('Enter newline tripwire', () => {
  let dispose: () => void;
  let debug: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    document.body.innerHTML = `
      <editor-host id="host">
        <affine-list data-block-id="list-1"><div id="text">task</div></affine-list>
        <affine-paragraph data-block-id="p-1"><div id="body">body</div></affine-paragraph>
      </editor-host>`;
    const host = document.getElementById('host') as HTMLElement & {
      std: unknown;
    };
    host.std = {
      event: { active: false },
      store: {
        id: 'doc-1',
        getBlock: (id: string) => ({
          model: {
            flavour: id.startsWith('list') ? 'affine:list' : 'affine:paragraph',
            props: { type: id.startsWith('list') ? 'todo' : 'text' },
          },
        }),
      },
    };
    debug = vi.fn<(...args: unknown[]) => void>();
    vi.spyOn(console, 'debug').mockImplementation(debug);
    dispose = installEnterNewlineTripwire();
  });

  afterEach(() => {
    dispose();
    vi.restoreAllMocks();
  });

  it('logs when a paragraph insert reaches a list item', () => {
    setSelectionIn(document.getElementById('text')!.firstChild!);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    document.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertParagraph' })
    );
    expect(debug).toHaveBeenCalledTimes(1);
    const [marker, kind, details] = debug.mock.calls[0]!;
    expect(marker).toBe(MARKER);
    expect(kind).toBe('enter-newline');
    expect(JSON.parse(details as string)).toMatchObject({
      block: { flavour: 'affine:list', type: 'todo', id: 'list-1' },
      keydownSeen: true,
      keydownPrevented: false,
      hosts: [{ doc: 'doc-1', active: false, hasCaret: true }],
    });
  });

  it('stays quiet for a plain paragraph (a newline there is not this bug)', () => {
    setSelectionIn(document.getElementById('body')!.firstChild!);
    document.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertParagraph' })
    );
    expect(debug).not.toHaveBeenCalled();
  });
});

describe('drag indicator tripwire', () => {
  let dispose: () => void;
  let debug: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="affine-data-view-list">
        <div class="affine-data-view-list-row" data-row-id="r1">
          <div class="affine-data-view-list-drag-handle" id="handle"></div>
        </div>
      </div>`;
    debug = vi.fn<(...args: unknown[]) => void>();
    vi.spyOn(console, 'debug').mockImplementation(debug);
    dispose = installDragIndicatorTripwire();
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const pointer = (type: string, y: number, target: EventTarget = document) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: 10, clientY: y })
    );

  it('logs once when a row drag goes on without a drop line', () => {
    pointer('pointerdown', 10, document.getElementById('handle')!);
    pointer('pointermove', 60);
    vi.advanceTimersByTime(400);
    pointer('pointermove', 80);
    pointer('pointermove', 90);
    pointer('pointerup', 90);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]![1]).toBe('drag-no-drop-line');
  });

  it('stays quiet while the drop line is shown', () => {
    pointer('pointerdown', 10, document.getElementById('handle')!);
    const line = document.createElement('div');
    line.dataset.isDropPreview = 'true';
    document.body.append(line);
    pointer('pointermove', 60);
    vi.advanceTimersByTime(400);
    pointer('pointermove', 80);
    pointer('pointerup', 80);
    expect(debug).not.toHaveBeenCalled();
  });
});
