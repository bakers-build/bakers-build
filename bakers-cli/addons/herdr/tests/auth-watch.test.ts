import { describe, expect, it } from 'vitest';
import { AUTH_WATCH_MS, watchAuth } from '../src/launch-script.js';

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

  it('counts its window from the claim, not the launch', async () => {
    let now = 100_000;
    let reads = 0;
    await watchAuth(
      async () => {
        reads += 1;
        return '> working on BB-1';
      },
      PATTERNS,
      {
        since: now - 60_000, // claimed a minute before the launch
        pollMs: 1000,
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
      },
    );
    expect(reads).toBe((AUTH_WATCH_MS - 60_000) / 1000);
  });

  it('still watches briefly after a setup that outlasted the window', async () => {
    let now = 1_000_000;
    let reads = 0;
    await watchAuth(
      async () => {
        reads += 1;
        return '> working on BB-1';
      },
      PATTERNS,
      {
        since: now - AUTH_WATCH_MS - 60_000,
        pollMs: 1000,
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
      },
    );
    expect(reads).toBe(30);
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
