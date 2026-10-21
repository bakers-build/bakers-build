import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  humanizeAge,
  parseDuration,
} from '../../src/lib/format.js';

// BB-340 Task 13 — `pad` AND `sanitizeDisplay` ARE DELETED, and the four
// cases that pinned them went WITH their subject rather than being weakened:
//
//   - pad measures the sanitized value / a value carrying a control character
//     still pads to the budget
//   - pad measures the sanitized value / an embedded newline can never survive
//     into a padded field
//   - pad measures the sanitized value / the ordinary cases are unchanged
//   - a zero column budget renders nothing / pad emits no column rather than a
//     lone ellipsis
//
// Each was a claim about a FIELD OF N DISPLAY COLUMNS, and there is no such
// field any more: the dashboard's bars and the run table state their columns as
// Yoga budgets, so the renderer places the value and nothing measures it
// (`lib/vnode.ts`'s `Cell`). What survives of the claim survives structurally —
// `tests/Component/stats-panel/index.test.ts` asserts that every row of a block
// declares the same budgets, and the Bun suite asserts what those budgets are
// worth on a real terminal (spec D8).

// BB-236 entity-slice phase 0 — `humanizeAge` moved here from
// `Deriver/liveness.ts`: it is a generic relative-time formatter with no conductor
// vocabulary, and keeping it there is what made a comment renderer and the run
// deriver both import a CONDUCTOR module. Its case came with it, assertion body
// byte-unchanged.
const NOW = 1_000_000;
it('humanizeAge formats relative age', () => {
  expect(humanizeAge(null, NOW)).toBe('—');
  expect(humanizeAge(NOW - 10, NOW)).toBe('just now');
  expect(humanizeAge(NOW - 180, NOW)).toBe('3m ago');
  expect(humanizeAge(NOW - 7200, NOW)).toBe('2h ago');
});

// BB-308 D5 — storage is SECONDS everywhere; this grammar exists only at the
// terminal edge, so an operator can type `1h 30m` instead of 5400.
describe('parseDuration', () => {
  it('reads a bare integer as minutes', () => {
    expect(parseDuration('90')).toBe(5400);
  });

  it('reads suffixed units and composes them', () => {
    expect(parseDuration('3h')).toBe(10_800);
    expect(parseDuration('90m')).toBe(5400);
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('1d 2h 30m')).toBe(95_400);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(parseDuration('  1H 30M ')).toBe(5400);
  });

  it('reads an empty input as an explicit zero-length clear', () => {
    expect(parseDuration('')).toBe(0);
  });

  it('returns null for anything that is not a duration', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('1x')).toBeNull();
    expect(parseDuration('-5m')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders largest unit first and drops empty leading units', () => {
    expect(formatDuration(95_400)).toBe('1d 2h 30m');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(600)).toBe('10m');
  });

  it('renders a zero as 0m rather than an empty string', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('renders an absent value as an em dash', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('round-trips every value parseDuration produced', () => {
    for (const input of ['90', '3h', '1d 2h 30m', '45m']) {
      const seconds = parseDuration(input);
      expect(seconds).not.toBeNull();
      expect(parseDuration(formatDuration(seconds as number))).toBe(seconds);
    }
  });
});
