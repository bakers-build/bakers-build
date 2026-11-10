import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from '../test/poller-setup.mjs';

const DAY = 24 * 60 * 60 * 1000;
const expiring = { name: 'pm-bot-claude-oauth-token', status: 'warning', expires_at: '2026-11-15', reason: 'expires in 10 days' };
const rejected = { name: 'claude', status: 'error', reason: 'not logged in — run claude /login' };

test('a box credential warning is posted to the bot channel when it first appears, then once a day while it lasts, and not after it clears', async (t) => {
  const { s, slack, poller, clock } = await setup(t);
  const box = s.addConductor({ label: 'acme-box', credential_health: [{ name: 'gh', status: 'ok', reason: 'valid' }, expiring] });

  await poller.pass();
  assert.deepEqual(slack.posts(), [
    { channel: 'CHOME', text: 'Warnung: Zugangsdaten pm-bot-claude-oauth-token auf acme-box, Ablaufdatum 2026-11-15. expires in 10 days' },
  ]);

  clock.now += 6 * 60 * 60 * 1000; // same UTC day
  await poller.pass();
  assert.equal(slack.posts().length, 1);

  clock.now += DAY;
  await poller.pass();
  await poller.pass();
  assert.equal(slack.posts().length, 2);

  box.credential_health = [{ name: 'pm-bot-claude-oauth-token', status: 'ok', expires_at: '2027-11-15', reason: 'valid' }];
  clock.now += DAY;
  await poller.pass();
  assert.equal(slack.posts().length, 2);
});

test('an error without an expiry date names credential, box and reason; a warning turning into an error is posted at once', async (t) => {
  const { s, slack, poller, language } = await setup(t);
  language('en');
  const box = s.addConductor({ label: 'south-box', credential_health: [{ ...rejected, status: 'warning' }] });
  await poller.pass();
  box.credential_health = [rejected];
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.text), [
    'Warning: credential claude on south-box. not logged in — run claude /login',
    'Error: credential claude on south-box. not logged in — run claude /login',
  ]);
});

test('a conductor list bakers.build refuses is logged and leaves the ticket posts alone', async (t) => {
  const { s, poller, errors } = await setup(t);
  s.addConductor({ credential_health: [expiring] });
  s.failOnce('bakers_conductor_list');
  await poller.pass();
  assert.ok(errors.some((line) => line.includes('credentials') && line.includes('bakers_conductor_list')), errors.join('\n'));
});

test('a rejected bakers.build API key is logged in one line naming it, and the pass asks for a back-off', async (t) => {
  const { s, poller, errors } = await setup(t);
  s.stub.revoke();
  const result = await poller.pass();
  assert.equal(result.rejected, 'BAKERS_API_KEY');
  assert.equal(errors.filter((line) => line.includes('BAKERS_API_KEY')).length, 1, errors.join('\n'));
});

test('a rejected Slack bot token is logged naming it, and the pass asks for a back-off', async (t) => {
  const { s, poller, errors } = await setup(t, { slackAnswers: { 'chat.postMessage': { ok: false, error: 'invalid_auth' } } });
  s.addConductor({ credential_health: [expiring] });
  const result = await poller.pass();
  assert.equal(result.rejected, 'SLACK_BOT_TOKEN');
  assert.ok(errors.some((line) => line.includes('SLACK_BOT_TOKEN')), errors.join('\n'));
});
