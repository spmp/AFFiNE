/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import {
  isRootComponentActive,
  isSelectionStaleForFocus,
  panelPaddingBottom,
} from '../utils';

describe('isRootComponentActive', () => {
  // keyboard-focus-tabbar-coordination (round 2): real on-device capture
  // (affine-dev-MobileDebugLog_debug-plus-1.log) shows the widget's
  // fallback show/hide keyboard actions silently no-op
  // (isActiveElement: false, inputModeBefore/After both "") while editing a
  // Journal Todo row -- because the actually-focused element (the row, or
  // its title cell's inline editor) is a DESCENDANT of rootComponent, never
  // rootComponent itself. See utils.ts doc comment for the full mechanism.

  it('returns false when there is no rootComponent', () => {
    const activeElement = document.createElement('div');
    expect(isRootComponentActive(null, activeElement)).toBe(false);
    expect(isRootComponentActive(undefined, activeElement)).toBe(false);
  });

  it('returns false when nothing is focused (activeElement is null)', () => {
    const rootComponent = document.createElement('div');
    expect(isRootComponentActive(rootComponent, null)).toBe(false);
  });

  it('returns true when rootComponent itself is the active element (legacy exact-match case)', () => {
    const rootComponent = document.createElement('div');
    expect(isRootComponentActive(rootComponent, rootComponent)).toBe(true);
  });

  it('returns true when the active element is a descendant of rootComponent -- e.g. a focused database/Journal Todo row', () => {
    const rootComponent = document.createElement('div');
    const row = document.createElement('div');
    row.tabIndex = 0;
    rootComponent.append(row);

    // real capture shows this is the actual case on-device: the focused
    // row is nested well inside rootComponent's subtree, never
    // rootComponent itself.
    expect(isRootComponentActive(rootComponent, row)).toBe(true);
  });

  it('returns true when the active element is a deeply nested descendant -- e.g. a row title cell inline editor', () => {
    const rootComponent = document.createElement('div');
    const row = document.createElement('div');
    const titleCell = document.createElement('data-view-header-area-text');
    const richText = document.createElement('rich-text');
    rootComponent.append(row);
    row.append(titleCell);
    titleCell.append(richText);

    expect(isRootComponentActive(rootComponent, richText)).toBe(true);
  });

  it('returns false when the active element is outside rootComponent entirely -- e.g. focus landed on an unrelated element', () => {
    const rootComponent = document.createElement('div');
    const unrelated = document.createElement('button');
    document.body.append(rootComponent, unrelated);

    expect(isRootComponentActive(rootComponent, unrelated)).toBe(false);
  });
});

describe('isSelectionStaleForFocus', () => {
  // 999.1 A-2 (db-row-toolbar-scroll): database rows never update
  // std.selection, so after moving from a paragraph into a Journal Todo row
  // the selection still names the paragraph. Tapping the already-focused row
  // re-mounts the toolbar, whose scroll-into-view then scrolled the page to
  // that stale paragraph while focus stayed in the row.
  function editable() {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    return el;
  }

  it('is stale when an editable element outside the selected block has focus (row focused, paragraph selected)', () => {
    const paragraph = document.createElement('div');
    const rowTitle = editable();
    expect(isSelectionStaleForFocus(paragraph, rowTitle)).toBe(true);
  });

  it('is not stale when focus is inside the selected block', () => {
    const paragraph = document.createElement('div');
    const inline = editable();
    paragraph.append(inline);
    expect(isSelectionStaleForFocus(paragraph, inline)).toBe(false);
  });

  it('is not stale when nothing editable has focus (keeps existing behaviour)', () => {
    const paragraph = document.createElement('div');
    expect(isSelectionStaleForFocus(paragraph, null)).toBe(false);
    expect(isSelectionStaleForFocus(paragraph, document.body)).toBe(false);
    expect(
      isSelectionStaleForFocus(paragraph, document.createElement('button'))
    ).toBe(false);
  });

  it('treats a focused input/textarea outside the block as stale', () => {
    const paragraph = document.createElement('div');
    expect(
      isSelectionStaleForFocus(paragraph, document.createElement('textarea'))
    ).toBe(true);
    expect(
      isSelectionStaleForFocus(paragraph, document.createElement('input'))
    ).toBe(true);
  });
});

describe('panelPaddingBottom', () => {
  // 999.1 62px floor: the spacer is box-sizing: border-box, so its
  // tab-bar safe-area padding was a hard minimum height. With the keyboard
  // open the real keyboard offset can be < 62px (full scroll), and the
  // toolbar stopped 62px above the keyboard.
  it('drops the tab-bar padding while the keyboard is open and no panel is open', () => {
    expect(panelPaddingBottom(false, true, '62px')).toBe('0px');
  });

  it('keeps the tab-bar padding while the keyboard is closed', () => {
    expect(panelPaddingBottom(false, false, '62px')).toBe('62px');
  });

  it('keeps the tab-bar padding while a "+" panel is open (keyboard hidden behind it)', () => {
    expect(panelPaddingBottom(true, true, '62px')).toBe('62px');
    expect(panelPaddingBottom(true, false, '62px')).toBe('62px');
  });
});
