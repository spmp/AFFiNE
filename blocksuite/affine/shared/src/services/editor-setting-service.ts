import { createIdentifier } from '@blocksuite/global/di';
import type { DeepPartial } from '@blocksuite/global/utils';
import type { ExtensionType } from '@blocksuite/store';
import type { Signal } from '@preact/signals-core';
import { z } from 'zod';

import { NodePropsSchema } from '../utils/index.js';

const TodoFieldDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number']),
});

export const TaskWorkflowDefaultsSchema = z.object({
  list: z
    .object({
      fieldDefs: z.array(TodoFieldDefSchema).default([]),
      fieldLayout: z.enum(['inline', 'aligned', 'right']).default('inline'),
      statusMapping: z
        .object({
          statusColumnName: z.string().default('Status'),
          doneTagLabel: z.string().default('Done'),
          notDoneTagLabel: z.string().optional(),
        })
        .default({}),
    })
    .default({}),
  database: z
    .object({
      taskStatusInheritance: z
        .object({
          done: z
            .enum(['require-all-subtasks-complete', 'disabled'])
            .default('require-all-subtasks-complete'),
          inProgress: z
            .enum(['start-when-any-subtask-starts', 'disabled'])
            .default('start-when-any-subtask-starts'),
          autoDemoteAutoDone: z.boolean().default(true),
          cascadeManualDoneToDescendants: z.boolean().default(true),
        })
        .default({}),
      kanbanColumns: z
        .array(z.string())
        .default(['Todo:todo', 'In Progress:in_progress', 'Done:done']),
    })
    .default({}),
});

export type TaskWorkflowDefaults = z.infer<typeof TaskWorkflowDefaultsSchema>;

export const GeneralSettingSchema = z
  .object({
    edgelessScrollZoom: z.boolean().default(false),
    edgelessDisableScheduleUpdate: z.boolean().default(false),
    edgelessLibraryShapesVisibility: z
      .enum(['disable', 'searchable', 'show'])
      .default('show'),
    edgelessMindmapNextColor: z
      .enum(['disable', 'children', 'depth'])
      .default('children'),
    edgelessMindmapPaletteSize: z
      .enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
      .default('11'),
    docCanvasPreferView: z
      .enum(['affine:embed-linked-doc', 'affine:embed-synced-doc'])
      .default('affine:embed-synced-doc'),
    taskWorkflowDefaults: TaskWorkflowDefaultsSchema.default({}),
  })
  .merge(NodePropsSchema);

export type EditorSetting = z.infer<typeof GeneralSettingSchema>;

export interface EditorSettingService {
  setting$: Signal<DeepPartial<EditorSetting>>;
  set?: (
    key: keyof EditorSetting,
    value: EditorSetting[keyof EditorSetting]
  ) => void;
}

export const EditorSettingProvider = createIdentifier<EditorSettingService>(
  'AffineEditorSettingProvider'
);

export function EditorSettingExtension(
  service: EditorSettingService
): ExtensionType {
  return {
    setup: di => {
      di.override(EditorSettingProvider, () => service);
    },
  };
}
