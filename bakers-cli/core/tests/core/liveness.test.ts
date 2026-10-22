import { describe, expect, it } from 'vitest';
import {
  deriveConductorLiveness,
  toUnixSeconds,
} from '../../src/core/liveness.js';

/**
 * One derivation of "is this conductor alive", shared by the CLI and the
 * cockpit.
 *
 * It used to exist twice with different words: the CLI said
 * `running | wedged | stopped | registry-only`, the renderer said
 * `running | stale | offline | registry-only`, and the server's ConductorDeriver
 * said a third thing. Two vocabularies for one fact is the defect — an operator
 * reading `wedged` in `bakers oven ls` and `stale` in the cockpit has no way
 * to know they mean the same conductor in the same condition.
 *
 * The words that survive are the server's, because they are what the dashboard
 * and the ticket board already show. BB-450 D11 renamed the kernel's fresh
 * state from `running` to `online` — the server's own word — so `stale` and
 * `offline` are no longer the only two the three surfaces agree on.
 */
describe('deriveConductorLiveness', () => {
  const NOW = 1_000_000;

  it('is online when it heartbeat recently and holds its lease', () => {
    expect(
      deriveConductorLiveness(
        { status: 'online', lastSeen: NOW - 10, leaseExpiresAt: NOW + 290 },
        NOW,
      ),
    ).toBe('online');
  });

  it('is offline when it says so — a stopped conductor stopped itself', () => {
    expect(
      deriveConductorLiveness(
        { status: 'offline', lastSeen: NOW - 10, leaseExpiresAt: NOW + 290 },
        NOW,
      ),
    ).toBe('offline');
  });

  it('is stale once the heartbeat is older than the stale window', () => {
    expect(
      deriveConductorLiveness(
        { status: 'online', lastSeen: NOW - 601, leaseExpiresAt: NOW + 290 },
        NOW,
      ),
    ).toBe('stale');
  });

  it('is stale once the lease has expired, however recent the heartbeat', () => {
    expect(
      deriveConductorLiveness(
        { status: 'online', lastSeen: NOW - 5, leaseExpiresAt: NOW - 1 },
        NOW,
      ),
    ).toBe('stale');
  });

  it('is stale when it never reported a heartbeat at all', () => {
    expect(deriveConductorLiveness({ status: 'online' }, NOW)).toBe('stale');
  });

  it('treats a crashed conductor as stale, not offline', () => {
    // The distinction matters: a crash leaves `online` on the record until the
    // cron reaper notices the lease lapse. Reading that as "online" would lock
    // out a restart for minutes; reading it as "offline" would claim a clean
    // shutdown that never happened.
    expect(
      deriveConductorLiveness(
        { status: 'online', lastSeen: NOW - 5000, leaseExpiresAt: NOW - 4700 },
        NOW,
      ),
    ).toBe('stale');
  });
});

// The control plane sends timestamps as ISO-8601 strings, not unix seconds
// (`last_seen: '2026-08-04T05:27:20+00:00'`). Discovered live: the cockpit
// showed a conductor that was demonstrably ticking as `stale` with age `—`,
// because a string failed a `typeof === 'number'` guard and became 0. The CLI
// had the mirror-image bug: it cast the string to `number` for the compiler
// only, so every comparison was NaN — and NaN comparisons are false, which
// silently made `stale` unreachable there.
describe('toUnixSeconds', () => {
  it('passes unix seconds through', () => {
    expect(toUnixSeconds(1_000_000)).toBe(1_000_000);
  });

  it('parses the ISO-8601 form the control plane actually sends', () => {
    expect(toUnixSeconds('2026-08-04T05:27:20+00:00')).toBe(
      Math.floor(Date.parse('2026-08-04T05:27:20+00:00') / 1000),
    );
  });

  it('treats absent and unparseable values as unknown, never as 1970', () => {
    expect(toUnixSeconds(null)).toBeNull();
    expect(toUnixSeconds(undefined)).toBeNull();
    expect(toUnixSeconds('')).toBeNull();
    expect(toUnixSeconds('not a date')).toBeNull();
    expect(toUnixSeconds(0)).toBeNull();
  });

  it('derives a live conductor as online from its ISO timestamps', () => {
    const now = Math.floor(Date.parse('2026-08-04T05:27:30+00:00') / 1000);
    expect(
      deriveConductorLiveness(
        {
          status: 'online',
          lastSeen: toUnixSeconds('2026-08-04T05:27:20+00:00'),
          leaseExpiresAt: toUnixSeconds('2026-08-04T05:32:20+00:00'),
        },
        now,
      ),
    ).toBe('online');
  });
});
