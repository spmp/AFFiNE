/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { isRootComponentActive } from '../utils';

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
