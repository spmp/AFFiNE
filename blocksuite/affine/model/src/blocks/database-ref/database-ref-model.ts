import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/store';

/**
 * A reference to a single `affine:database` block, addressed by stable id.
 *
 * Unlike `affine:surface-ref` (which resolves/renders Gfx-canvas elements —
 * Frame, group, mindmap — by cropping an edgeless viewport around the
 * target's `xywh` bound), a database block has no Gfx/`xywh` capability: it
 * only ever lives as flow content inside an `affine:note`. So this is a
 * distinct block type rather than a `refFlavour` variant of `surface-ref`.
 *
 * `refDocId` is optional and defaults to the current doc when absent — this
 * block currently only supports same-doc references (multiple views of one
 * table on the same page, mirroring how a Frame can appear more than once
 * via `surface-ref`); cross-doc addressing is a planned follow-on once the
 * same-doc case is solid.
 */
export type DatabaseRefProps = {
  refBlockId: string;
  refDocId?: string;
  caption: string;
};

export const DatabaseRefBlockSchema = defineBlockSchema({
  flavour: 'affine:database-ref',
  props: (): DatabaseRefProps => ({
    refBlockId: '',
    refDocId: undefined,
    caption: '',
  }),
  metadata: {
    version: 1,
    role: 'content',
    parent: ['affine:note', 'affine:paragraph', 'affine:list'],
  },
  toModel: () => new DatabaseRefBlockModel(),
});

export const DatabaseRefBlockSchemaExtension = BlockSchemaExtension(
  DatabaseRefBlockSchema
);

export class DatabaseRefBlockModel extends BlockModel<DatabaseRefProps> {}
