import { cssVarV2 } from '@blocksuite/affine-shared/theme';
import { css } from '@emotion/css';

export const titleCellStyle = css({
  width: '100%',
  display: 'flex',
});

export const titleRichTextStyle = css({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  outline: 'none',
  wordBreak: 'break-all',
  fontSize: 'var(--data-view-cell-text-size)',
  lineHeight: 'var(--data-view-cell-text-line-height)',
});

export const headerAreaIconStyle = css({
  height: 'max-content',
  display: 'flex',
  alignItems: 'center',
  marginRight: '8px',
  padding: '2px',
  borderRadius: '4px',
  marginTop: '2px',
  color: cssVarV2.icon.primary,
  backgroundColor: 'var(--affine-background-secondary-color)',
});

export const titleTaskCheckboxStyle = css({
  // `relative` — required so `playCheckAnimation`'s absolutely-positioned
  // spark-burst element (appended as a child of this checkbox on check) is
  // positioned relative to the checkbox itself. Without this, the spark
  // has no positioned ancestor to anchor to here and falls back to
  // whichever ancestor further up the tree happens to be positioned (or
  // the viewport), rendering nowhere near the actual checkbox. Mirrors
  // `affine:list`'s own todo checkbox, which already has this via its
  // parent `.affine-list-block__prefix` class.
  position: 'relative',
  height: 'max-content',
  display: 'flex',
  alignItems: 'center',
  marginRight: '8px',
  marginTop: '2px',
  color: cssVarV2.icon.primary,
  cursor: 'pointer',
  selectors: {
    '&.readonly': {
      cursor: 'default',
      opacity: 0.5,
    },
  },
});
