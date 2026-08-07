import { createIdentifier } from '@blocksuite/global/di';
import type { EditorHost } from '@blocksuite/std';

/**
 * Lets any `data-view` component (core renderers, or a consuming block
 * package's own cell renderers) reach the real `EditorHost` via
 * `view.serviceGet(EditorHostKey)`/`dataSource.serviceGet(...)` — defined
 * here (not in `@blocksuite/affine-block-database`) so `data-view`'s own
 * core view-preset renderers (e.g. list view's row-level actions) can use
 * the same identifier without a backwards dependency on a block package
 * that itself depends on `data-view`.
 */
export const EditorHostKey = createIdentifier<EditorHost>('editor-host');
