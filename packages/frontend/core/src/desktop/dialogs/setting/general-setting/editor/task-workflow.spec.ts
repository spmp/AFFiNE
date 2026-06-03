import { describe, expect, test } from 'vitest';

import {
  parseTaskWorkflowColumns,
  parseTaskWorkflowFields,
  serializeTaskWorkflowFields,
} from './task-workflow-utils';

describe('task workflow settings parsing', () => {
  test('parses key and number type without rewriting while typing', () => {
    expect(parseTaskWorkflowFields('cost:number')).toEqual([
      { key: 'cost', type: 'number', label: 'cost' },
    ]);
  });

  test('parses optional labels and multiple fields', () => {
    expect(
      parseTaskWorkflowFields('cost:number:Cost, owner:text:Owner')
    ).toEqual([
      { key: 'cost', type: 'number', label: 'Cost' },
      { key: 'owner', type: 'text', label: 'Owner' },
    ]);
  });

  test('serializes committed fields in the editable format', () => {
    expect(
      serializeTaskWorkflowFields([
        { key: 'cost', type: 'number', label: 'Cost' },
        { key: 'owner', type: 'text', label: 'Owner' },
      ])
    ).toBe('cost:number:Cost, owner:text:Owner');
  });

  test('keeps default labels concise after commit', () => {
    expect(
      serializeTaskWorkflowFields([
        { key: 'cost', type: 'number', label: 'cost' },
      ])
    ).toBe('cost:number');
  });

  test('parses workflow columns with explicit semantics', () => {
    expect(
      parseTaskWorkflowColumns(
        'Todo:todo, In Progress:in_progress, Review:in-progress, Not Doing:none'
      )
    ).toEqual([
      'Todo:todo',
      'In Progress:in_progress',
      'Review:in_progress',
      'Not Doing:none',
    ]);
  });

  test('keeps labels when workflow semantics are missing or invalid', () => {
    expect(parseTaskWorkflowColumns('Draft, Review:later')).toEqual([
      'Draft',
      'Review',
    ]);
  });
});
