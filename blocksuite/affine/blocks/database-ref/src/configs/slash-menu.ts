import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import { DatabaseBlockSchema } from '@blocksuite/affine-model';
import {
  type SlashMenuActionItem,
  type SlashMenuConfig,
  SlashMenuConfigExtension,
} from '@blocksuite/affine-widget-slash-menu';
import { DatabaseTableViewIcon } from '@blocksuite/icons/lit';
import { BlockSelection } from '@blocksuite/std';

import { insertDatabaseRefBlockCommand } from '../commands';

/**
 * Same-doc "insert another view of this Table" items — mirrors how
 * `surface-ref`'s slash-menu enumerates current-doc frames. The very first
 * table a user creates (via the ordinary, untouched `/database` command)
 * stays exactly as it is; picking one of these items is what triggers
 * `insertDatabaseRefBlockCommand`'s promotion (see commands.ts) the first
 * time a second reference to it is created.
 */
const databaseRefSlashMenuConfig: SlashMenuConfig = {
  items: ({ std, model }) => {
    let index = 0;

    const databaseBlocks = std.store.getBlocksByFlavour(
      DatabaseBlockSchema.model.flavour
    );

    return databaseBlocks
      .filter(block => block.id !== model.id)
      .map<SlashMenuActionItem>(block => {
        const databaseModel = block.model as DatabaseBlockModel;
        const title = databaseModel.props.title.toString();
        return {
          name: 'Table: ' + (title || '(untitled)'),
          icon: DatabaseTableViewIcon(),
          group: `5_Edgeless Element@${index++}`,
          action: () => {
            const [_, result] = std.command.exec(
              insertDatabaseRefBlockCommand,
              {
                refBlockId: block.id,
                place: 'after',
                removeEmptyLine: true,
                selectedModels: [model],
              }
            );
            if (!result.insertedDatabaseRefBlockId) return;
            std.selection.set([
              std.selection.create(BlockSelection, {
                blockId: result.insertedDatabaseRefBlockId,
              }),
            ]);
          },
        };
      });
  },
};

export const DatabaseRefSlashMenuConfigExtension = SlashMenuConfigExtension(
  'affine:database-ref',
  databaseRefSlashMenuConfig
);
