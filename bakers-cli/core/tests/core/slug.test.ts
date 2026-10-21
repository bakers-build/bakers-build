import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/core/slug.js';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumeric runs to single dashes', () => {
    expect(slugify('Readable herdr tab + worktree names')).toBe(
      'readable-herdr-tab-worktree-names',
    );
  });

  it('trims leading/trailing separators', () => {
    expect(slugify('  (ticket id) ')).toBe('ticket-id');
  });

  it('caps to maxLength without a trailing dash', () => {
    // 'aaaa-bbbb-cccc' capped at 10 -> 'aaaa-bbbb' (no dangling dash)
    expect(slugify('aaaa bbbb cccc', 10)).toBe('aaaa-bbbb');
  });

  it('returns empty for input with no usable characters', () => {
    expect(slugify('   ***   ')).toBe('');
    expect(slugify('')).toBe('');
  });
});
