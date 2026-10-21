import { expect, it } from 'vitest';
import type { RunRow } from '../../../../src/Entity/run/Data/runs.js';
import {
  deriveRunStatus,
  runStartedAge,
} from '../../../../src/Entity/run/Data/status.js';

// 2026-07-21T16:00:00Z as unix seconds — the reference "now".
const NOW = Math.floor(Date.parse('2026-07-21T16:00:00+00:00') / 1000);

function row(over: Partial<RunRow>): RunRow {
  return {
    id: 'r',
    drupalId: 1,
    ticketId: 't',
    ticketIdentifier: 'BB-1',
    state: 'running',
    phase: 'coding',
    agent: 'claude',
    startedAt: null,
    heartbeat: null,
    claimExpiresAt: null,
    ...over,
  };
}

it.each([
  ['done', 'done'],
  ['expired', 'expired'],
  ['failed', 'failed'],
] as const)('passes terminal state %s through', (state, expected) => {
  expect(deriveRunStatus(row({ state }), NOW)).toBe(expected);
});

it('running with a fresh heartbeat and future claim stays running', () => {
  expect(
    deriveRunStatus(
      row({
        state: 'running',
        heartbeat: '2026-07-21T15:59:00+00:00', // 1m ago
        claimExpiresAt: '2026-07-21T17:00:00+00:00', // future
      }),
      NOW,
    ),
  ).toBe('running');
});

it('running with a stale heartbeat is stale', () => {
  expect(
    deriveRunStatus(
      row({
        state: 'running',
        heartbeat: '2026-07-21T15:40:00+00:00', // 20m ago > 600s
        claimExpiresAt: '2026-07-21T17:00:00+00:00',
      }),
      NOW,
    ),
  ).toBe('stale');
});

it('claimed with a fresh heartbeat but an expired claim is stale', () => {
  expect(
    deriveRunStatus(
      row({
        state: 'claimed',
        heartbeat: '2026-07-21T15:59:00+00:00', // fresh
        claimExpiresAt: '2026-07-21T15:30:00+00:00', // past
      }),
      NOW,
    ),
  ).toBe('stale');
});

it('humanizes the relative started age; null → dash', () => {
  expect(
    runStartedAge(row({ startedAt: '2026-07-21T15:00:00+00:00' }), NOW),
  ).toBe('1h ago');
  expect(runStartedAge(row({ startedAt: null }), NOW)).toBe('—');
});
