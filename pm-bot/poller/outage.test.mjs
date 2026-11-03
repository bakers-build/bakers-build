import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from '../test/poller-setup.mjs';
import { thread } from '../test/site.mjs';

test('through 5xx and a refused connection the poller keeps passing and then posts each event exactly once', async (t) => {
  const { s, slack, sent, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'plan', links: [thread()] });
  await poller.pass();

  // Events happen while bakers.build is down.
  ticket.state = 'working';
  s.addComment(ticket, { body: 'Weekends too?', created: '2026-11-02T10:00:00+00:00' });
  Object.assign(ticket, { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['Question'] });

  s.stub.outage(3, 503);
  await assert.doesNotReject(poller.pass());
  s.stub.outage(2, 502);
  await assert.doesNotReject(poller.pass());
  await s.stub.down();
  await assert.doesNotReject(poller.pass());
  await assert.doesNotReject(poller.pass());
  await s.stub.up();
  assert.deepEqual(slack.posts(), []);
  assert.deepEqual(sent, []);

  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.text), ['Work on this has started.']);
  assert.deepEqual(sent.map((m) => m.text), ['The implementation of the "Price updater" ticket has a question:\n\nWeekends too?']);
});
