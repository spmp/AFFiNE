import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';

import type { VElement, VLine } from '../components/index.js';
import { INLINE_ROOT_ATTR, ZERO_WIDTH_FOR_EMPTY_LINE } from '../consts.js';
import type { DomPoint, TextPoint } from '../types.js';
import {
  isInlineRoot,
  isNativeTextInVText,
  isVElement,
  isVLine,
} from './guard.js';
import {
  calculateTextLength,
  getInlineRootTextCache,
  getTextNodesFromElement,
  invalidateInlineRootTextCache,
} from './text.js';

/**
 * `side` says which end of a range the point is. It matters for a point
 * given as (element, child index), i.e. a boundary between two lines: the
 * start of a range there is the start of the next text, the end of a range
 * is the end of the previous text. Without it such a point is resolved
 * roughly, as before.
 */
export function nativePointToTextPoint(
  node: unknown,
  offset: number,
  side?: 'start' | 'end'
): TextPoint | null {
  if (isNativeTextInVText(node)) {
    return [node, offset];
  }

  if (isVElement(node)) {
    const texts = getTextNodesFromElement(node);
    const vElement = texts[0].parentElement?.closest('[data-v-element="true"]');

    if (
      texts.length === 1 &&
      vElement instanceof HTMLElement &&
      vElement.dataset.vEmbed === 'true'
    ) {
      return [texts[0], 0];
    }

    if (texts.length > 0) {
      return texts[offset] ? [texts[offset], 0] : null;
    }
  }

  if (isVLine(node) || isInlineRoot(node)) {
    if (side) {
      return getTextPointFromElementBoundary(node, offset, side);
    }
    return getTextPointRoughlyFromElementByOffset(node, offset, true);
  }

  if (!(node instanceof Node)) {
    return null;
  }

  const vNodes = getVNodesFromNode(node);

  if (vNodes) {
    return getTextPointFromVNodes(vNodes, node, offset);
  }

  return null;
}

export function textPointToDomPoint(
  text: Text,
  offset: number,
  rootElement: HTMLElement
): DomPoint | null {
  if (rootElement.dataset.vRoot !== 'true') {
    throw new BlockSuiteError(
      ErrorCode.InlineEditorError,
      'textRangeToDomPoint should be called with editor root element'
    );
  }

  if (!rootElement.contains(text)) return null;

  const textParentElement = text.parentElement;
  if (!textParentElement) {
    throw new BlockSuiteError(
      ErrorCode.InlineEditorError,
      'text element parent not found'
    );
  }

  const lineElement = textParentElement.closest('v-line');

  if (!lineElement) {
    throw new BlockSuiteError(
      ErrorCode.InlineEditorError,
      'line element not found'
    );
  }

  const textOffset = text.wholeText === ZERO_WIDTH_FOR_EMPTY_LINE ? 0 : offset;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { textNodes, textNodeIndexMap, prefixLengths, lineIndexMap } =
      getInlineRootTextCache(rootElement);
    if (textNodes.length === 0) return null;

    const goalIndex = textNodeIndexMap.get(text);
    const lineIndex = lineIndexMap.get(lineElement);
    if (goalIndex !== undefined && lineIndex !== undefined) {
      const index = (prefixLengths[goalIndex] ?? 0) + textOffset;
      return { text, index: index + lineIndex };
    }

    if (attempt === 0) {
      // MutationObserver marks cache dirty asynchronously; force one sync retry
      // when a newly-added node is queried within the same task.
      invalidateInlineRootTextCache(rootElement);
    }
  }

  // Fallback to linear scan when cache still misses. This keeps behavior
  // stable even if MutationObserver-based invalidation lags behind.
  const texts = getTextNodesFromElement(rootElement);
  if (texts.length === 0) return null;

  const goalIndex = texts.indexOf(text);
  if (goalIndex < 0) return null;

  let index = textOffset;
  for (const beforeText of texts.slice(0, goalIndex)) {
    index += calculateTextLength(beforeText);
  }

  const lineIndex = Array.from(rootElement.querySelectorAll('v-line')).indexOf(
    lineElement
  );
  if (lineIndex < 0) return null;

  return { text, index: index + lineIndex };
}

function getVNodesFromNode(node: Node): VElement[] | VLine[] | null {
  const vLine = node.parentElement?.closest('v-line');

  if (vLine) {
    return Array.from(vLine.querySelectorAll('v-element'));
  }

  const container =
    node instanceof Element
      ? node.closest(`[${INLINE_ROOT_ATTR}]`)
      : node.parentElement?.closest(`[${INLINE_ROOT_ATTR}]`);

  if (container) {
    return Array.from(container.querySelectorAll('v-line'));
  }

  return null;
}

function getTextPointFromVNodes(
  vNodes: VLine[] | VElement[],
  node: Node,
  offset: number
): TextPoint | null {
  const first = vNodes[0];
  for (let i = 0; i < vNodes.length; i++) {
    const vNode = vNodes[i];

    if (i === 0 && AFollowedByB(node, vNode)) {
      return getTextPointRoughlyFromElementByOffset(first, offset, true);
    }

    if (AInsideB(node, vNode)) {
      return getTextPointRoughlyFromElementByOffset(first, offset, false);
    }

    if (i === vNodes.length - 1 && APrecededByB(node, vNode)) {
      return getTextPointRoughlyFromElement(vNode);
    }

    if (
      i < vNodes.length - 1 &&
      APrecededByB(node, vNode) &&
      AFollowedByB(node, vNodes[i + 1])
    ) {
      return getTextPointRoughlyFromElement(vNode);
    }
  }

  return null;
}

function getTextPointRoughlyFromElement(element: Element): TextPoint | null {
  const texts = getTextNodesFromElement(element);
  if (texts.length === 0) return null;
  const text = texts[texts.length - 1];
  return [text, calculateTextLength(text)];
}

function getTextPointRoughlyFromElementByOffset(
  element: Element,
  offset: number,
  fromStart: boolean
): TextPoint | null {
  const texts = getTextNodesFromElement(element);
  if (texts.length === 0) return null;
  const text = fromStart ? texts[0] : texts[texts.length - 1];
  return [text, offset === 0 ? offset : text.length];
}

/**
 * The text point at the boundary before `element.childNodes[offset]`: for
 * the start of a range, the start of the first text at or after it; for the
 * end, the end of the last text before it. (Firefox gives a delete's target
 * range this way, e.g. (inline root, 0) to (inline root, 20) for a
 * selection over several lines; read roughly, the end became the end of
 * the first line and only that line was deleted.)
 */
function getTextPointFromElementBoundary(
  element: Element,
  offset: number,
  side: 'start' | 'end'
): TextPoint | null {
  const texts = getTextNodesFromElement(element);
  const first = texts[0];
  const last = texts.at(-1);
  if (!first || !last) return null;
  const boundary = element.childNodes[offset];
  if (!boundary) return [last, last.length];
  const before = texts.filter(
    text =>
      !boundary.contains(text) &&
      !!(
        boundary.compareDocumentPosition(text) &
        Node.DOCUMENT_POSITION_PRECEDING
      )
  );
  if (side === 'end') {
    const text = before.at(-1);
    return text ? [text, text.length] : [first, 0];
  }
  const text = texts[before.length];
  return text ? [text, 0] : [last, last.length];
}

function AInsideB(a: Node, b: Node): boolean {
  return (
    b.compareDocumentPosition(a) === Node.DOCUMENT_POSITION_CONTAINED_BY ||
    b.compareDocumentPosition(a) ===
      (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING)
  );
}

function AFollowedByB(a: Node, b: Node): boolean {
  return a.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING;
}

function APrecededByB(a: Node, b: Node): boolean {
  return a.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_PRECEDING;
}
