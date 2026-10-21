import { describe, expect, it } from 'vitest';
import { shellQuote } from '../../src/core/shell.js';

describe('shellQuote', () => {
  it('single-quotes a plain value', () => {
    expect(shellQuote('do the thing')).toBe("'do the thing'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("keeps newlines literal — POSIX single quotes, never bash-only $'…'", () => {
    expect(shellQuote("a\nit's")).toBe("'a\nit'\\''s'");
  });
});
