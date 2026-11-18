import { z } from 'zod';

/** Whole rows selected in a List view, in view order. */
export const ListViewSelectionWithTypeSchema = z.object({
  viewId: z.string(),
  type: z.literal('list'),
  rows: z.array(z.string()),
  /** The row Shift+click and Shift+arrows extend from. */
  anchor: z.string().optional(),
  /** The row Shift+arrows move. */
  focus: z.string().optional(),
});

export type ListViewSelectionWithType = z.TypeOf<
  typeof ListViewSelectionWithTypeSchema
>;
