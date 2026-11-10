import { describe, expect, it } from 'vitest';
import { watchAuth } from '../src/launch-script.js';

const PATTERNS = [
  { pattern: /Select login method/, reason: 'claude: not logged in' },
  {
    pattern: /OAuth token has expired/i,
    reason: 'claude: credential rejected',
  },
];

/** A pane that shows `frames` in turn, the last repeating. */
function pane(frames: string[]) {
  let i = 0;
  return async () => frames[Math.min(i++, frames.length - 1)] as string;
}

const instant = { pollMs: 1, sleep: async () => {} };

describe('watchAuth', () => {
  it('resolves with the reason of the first pattern the pane shows', async () => {
    const read = pane([
      'Welcome to Claude Code',
      'Select login method:\n 1. Claude account',
    ]);
    expect(
      await watchAuth(read, PATTERNS, { ...instant, windowMs: 1000 }),
    ).toBe('claude: not logged in');
  });

  it('resolves undefined when the window passes without a match', async () => {
    let now = 0;
    const result = await watchAuth(pane(['> working on BB-1']), PATTERNS, {
      windowMs: 30,
      pollMs: 10,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    });
    expect(result).toBeUndefined();
  });

  it('keeps watching through an unreadable pane', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) throw new Error('pane gone');
      return 'API Error: 401 OAuth token has expired';
    };
    expect(
      await watchAuth(read, PATTERNS, { ...instant, windowMs: 1000 }),
    ).toBe('claude: credential rejected');
  });
});
