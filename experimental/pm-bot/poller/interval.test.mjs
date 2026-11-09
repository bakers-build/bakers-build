import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heartbeatInterval, pollInterval } from './interval.mjs';

test('an unset interval polls every 15 seconds', () => {
  assert.equal(pollInterval(undefined), 15000);
});

test('an explicit interval overrides the default', () => {
  assert.equal(pollInterval('60'), 60000);
});

test('an empty interval falls back to 15 seconds', () => {
  assert.equal(pollInterval(''), 15000);
});

test('an unset heartbeat interval is 30 minutes', () => {
  assert.equal(heartbeatInterval(undefined), 1800000);
});

test('an explicit heartbeat interval in seconds overrides the default', () => {
  assert.equal(heartbeatInterval('600'), 600000);
});
