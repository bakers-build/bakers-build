import { expect, it } from 'vitest';
import { deriveConductorStatus } from '../../../../src/Entity/conductor/Data/liveness.js';

const NOW = 1_000_000;
const base = {
  present: true,
  status: 'online',
  lastSeen: NOW - 10,
  leaseExpiresAt: NOW + 60,
};

it('no server record → registry-only', () => {
  expect(deriveConductorStatus({ present: false }, NOW)).toBe('registry-only');
});
it('offline wins over freshness', () => {
  expect(deriveConductorStatus({ ...base, status: 'offline' }, NOW)).toBe(
    'offline',
  );
});
it('online when fresh + lease valid', () => {
  expect(deriveConductorStatus(base, NOW)).toBe('online');
});
it('stale when last_seen older than 600s', () => {
  expect(deriveConductorStatus({ ...base, lastSeen: NOW - 601 }, NOW)).toBe(
    'stale',
  );
});
it('stale when lease expired', () => {
  expect(deriveConductorStatus({ ...base, leaseExpiresAt: NOW - 1 }, NOW)).toBe(
    'stale',
  );
});
it('stale when last_seen is null but record present', () => {
  expect(deriveConductorStatus({ ...base, lastSeen: null }, NOW)).toBe('stale');
});
// `humanizeAge`'s case moved with the function to `tests/lib/format.test.ts`
// (BB-236 entity-slice Phase 0), assertion body unchanged.
