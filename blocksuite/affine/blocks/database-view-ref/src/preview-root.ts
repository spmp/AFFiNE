import { BlockComponent } from '@blocksuite/std';
import { BlockViewIdentifier } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { css, html } from 'lit';
import { literal } from 'lit/static-html.js';

/**
 * Near-identical to `database-ref/src/preview-root.ts`'s own
 * `DatabaseRefPreviewRootBlockComponent`/`DatabaseRefPreviewRootOverride` —
 * same reasoning applies unchanged: `preview-page`'s stock root hides any
 * `EdgelessOnly` note, exactly where the hidden canonical database lives
 * (see `commands.ts`'s `ensurePromoted`/`moveIntoHiddenNote`, reused
 * directly from `@blocksuite/affine-block-database-ref`).
 */
export class DatabaseViewRefPreviewRootBlockComponent extends BlockComponent {
  static override styles = css`
    affine-database-view-ref-preview-root {
      display: block;
    }
  `;

  override renderBlock() {
    const widgets = html`${Object.values(this.widgets)}`;
    const children = this.renderChildren(this.model);
    return html`<div class="affine-database-view-ref-preview-root">
      ${children} ${widgets}
    </div>`;
  }
}

if (!customElements.get('affine-database-view-ref-preview-root')) {
  customElements.define(
    'affine-database-view-ref-preview-root',
    DatabaseViewRefPreviewRootBlockComponent
  );
}

export const DatabaseViewRefPreviewRootOverride: ExtensionType = {
  setup: di => {
    di.override(
      BlockViewIdentifier('affine:page'),
      () => literal`affine-database-view-ref-preview-root`
    );
  },
};
