import type {
  KeyboardSubToolbarConfig,
  KeyboardToolbarActionItem,
  KeyboardToolbarItem,
  KeyboardToolPanelConfig,
} from './config.js';

export function isKeyboardToolBarActionItem(
  item: KeyboardToolbarItem
): item is KeyboardToolbarActionItem {
  return 'action' in item;
}

export function isKeyboardSubToolBarConfig(
  item: KeyboardToolbarItem
): item is KeyboardSubToolbarConfig {
  return 'items' in item;
}

export function isKeyboardToolPanelConfig(
  item: KeyboardToolbarItem
): item is KeyboardToolPanelConfig {
  return 'groups' in item;
}

export function formatDate(date: Date) {
  // yyyy-mm-dd
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const strTime = `${year}-${month}-${day}`;
  return strTime;
}

export function formatTime(date: Date) {
  // mm-dd hh:mm
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const strTime = `${month}-${day} ${hours}:${minutes}`;
  return strTime;
}

/**
 * keyboard-focus-tabbar-coordination (round 2): the widget's fallback
 * `show`/`hide` keyboard actions (`widget.ts`, used whenever the platform's
 * `VirtualKeyboardProvider` does not itself implement `show`/`hide` -- true
 * on BOTH the PWA `createVisualViewportVirtualKeyboardProvider` and the
 * native iOS Capacitor provider, per that file's own "Keyboard.show() is
 * not implemented" comment) only take effect when the widget's own
 * `rootComponent` -- the page/note ROOT block's component, not any specific
 * row -- IS `document.activeElement`. Real on-device capture
 * (`affine-dev-MobileDebugLog_debug-plus-1.log`) shows a
 * `keyboard-toolbar-inputmode-toggle` event fired with `isActiveElement:
 * false, inputModeBefore: "", inputModeAfter: ""` -- a confirmed silent
 * no-op -- while editing a Journal Todo row, whose actual focused element
 * (the row itself, or its title cell's inline editor, per
 * `list/pc/renderer.ts`'s `focusRowTitle`) is never literally
 * `rootComponent`, even though it IS a DOM descendant of it (this package
 * uses `ShadowlessElement` throughout -- no shadow-root boundary blocks a
 * `.contains()` check). Exact equality was too strict for row/cell-level
 * editing contexts; membership in the root's own subtree is the correct
 * test for "the editor area currently has focus." This is the confirmed
 * mechanism behind both the "+' button doesn't collapse the keyboard" and
 * "keyboard-toggle button doesn't (re)open the keyboard" reports.
 */
export function isRootComponentActive(
  rootComponent: HTMLElement | null | undefined,
  activeElement: Element | null
): boolean {
  return !!rootComponent && rootComponent.contains(activeElement);
}

/**
 * 999.1 A-2: `std.selection` can name a block the user has already left.
 * Database rows (Journal Todo) are data-view output, not block-tree
 * components, so focusing one never updates `std.selection`; the selection
 * keeps pointing at the paragraph the user was in before. The toolbar's
 * scroll-into-view then scrolled the page to that stale paragraph whenever
 * it re-ran (e.g. the toolbar re-mounting on a tap of the already-focused
 * row), while focus stayed in the row.
 *
 * The selection is stale when an editable element has focus and is not
 * inside the selected block. With nothing editable focused, keep the
 * existing behaviour (not stale).
 */
export function isSelectionStaleForFocus(
  selectedBlock: Element,
  activeElement: Element | null | undefined
): boolean {
  if (!activeElement) return false;
  const tag = activeElement.tagName;
  const editable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (activeElement instanceof HTMLElement &&
      (activeElement.isContentEditable ||
        activeElement.getAttribute('contenteditable') === 'true'));
  if (!editable) return false;
  return !selectedBlock.contains(activeElement);
}
