import { expect, it } from 'vitest';
import {
  emptyContributions,
  PRESET_FUNCTION_KEYS,
  SURFACE_KEYS,
} from '../../src/plugins/preset.js';

it('runs uiEntries on the connection surface', () => {
  expect(SURFACE_KEYS.connection).toEqual(['connectionPlugins', 'uiEntries']);
});

it('accumulates module specifiers, not contributions', () => {
  expect(emptyContributions().uiEntries).toEqual([]);
  expect(PRESET_FUNCTION_KEYS).toContain('uiEntries');
});
