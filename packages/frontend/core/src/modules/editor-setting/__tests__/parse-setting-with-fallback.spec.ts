import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { parseSettingWithFallback } from '../entities/editor-setting';

describe('parseSettingWithFallback', () => {
  const schema = z
    .object({
      color: z.string(),
      width: z.number(),
    })
    .default({ color: 'black', width: 4 });

  test('returns the parsed value when it already validates', () => {
    expect(
      parseSettingWithFallback(schema, { color: 'red', width: 2 })
    ).toEqual({ color: 'red', width: 2 });
  });

  test('backfills a newly-required field while preserving other stored fields', () => {
    // Simulates a value persisted before `width` existed on the schema.
    expect(parseSettingWithFallback(schema, { color: 'red' })).toEqual({
      color: 'red',
      width: 4,
    });
  });

  test('falls back to the full default when the stored value is not an object', () => {
    expect(parseSettingWithFallback(schema, 'not-an-object')).toEqual({
      color: 'black',
      width: 4,
    });
  });

  test('falls back to the full default when the stored value is undefined', () => {
    expect(parseSettingWithFallback(schema, undefined)).toEqual({
      color: 'black',
      width: 4,
    });
  });

  test('falls back to the full default when a stored field is invalid even after backfilling', () => {
    expect(
      parseSettingWithFallback(schema, { color: 42, width: 'not-a-number' })
    ).toEqual({ color: 'black', width: 4 });
  });
});
