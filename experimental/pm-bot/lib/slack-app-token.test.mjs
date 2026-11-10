import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slackStub } from '../test/stubs.mjs';
import { appTokenRejected } from './slack-app-token.mjs';

async function check(t, answer) {
  const stub = await slackStub({ 'apps.connections.open': answer });
  t.after(stub.close);
  return { stub, rejected: await appTokenRejected({ url: stub.url, token: 'xapp-fixture' }) };
}

test('an accepted app token is no rejection', async (t) => {
  const { rejected, stub } = await check(t, { ok: true, url: 'wss://example' });
  assert.equal(rejected, null);
  assert.deepEqual(stub.calls.map((c) => c.method), ['apps.connections.open']);
});

test('a rejected app token is named with the answer Slack gave', async (t) => {
  const { rejected } = await check(t, { ok: false, error: 'invalid_auth' });
  assert.match(rejected, /Slack rejected SLACK_APP_TOKEN \(invalid_auth\)/);
});

test('another Slack error or an unreachable Slack is not a rejection', async (t) => {
  const { rejected } = await check(t, { ok: false, error: 'ratelimited' });
  assert.equal(rejected, null);
  assert.equal(await appTokenRejected({ url: 'http://127.0.0.1:9/api', token: 'xapp-fixture' }), null);
});
