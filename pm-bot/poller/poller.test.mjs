import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setup } from '../test/poller-setup.mjs';
import { PROJECT, thread } from '../test/site.mjs';

const messages = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));

function frozenWithQuestion(s, ticket, body = 'Should it run at 3 a.m.?') {
  const question = s.addComment(ticket, { body, created: '2026-11-02T10:00:00+00:00' });
  Object.assign(ticket, { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['Question'] });
  return question;
}

test('the first pass records the states and posts nothing; a later change is posted once, naming the state', async (t) => {
  const { s, slack, poller, state } = await setup(t);
  const ticket = s.addTicket({ state: 'qualification', links: [thread()] });
  await poller.pass();
  assert.deepEqual(slack.posts(), []);
  assert.deepEqual(state().tickets, { 'ACME-1': 'qualification' });
  ticket.state = 'working';
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts(), [{ channel: 'C0000000001', thread_ts: '1700000000.000100', text: messages.states.working }]);
});

test('the poller reads every page of the project\'s tickets, through bakers tools only', async (t) => {
  const { s, slack, poller } = await setup(t, { pageSize: 2 });
  s.addTicket({ state: 'plan', links: [thread('C0000000001')] });
  s.addTicket({ state: 'plan', links: [thread('C0000000002')] });
  const third = s.addTicket({ state: 'plan', links: [thread('C0000000003')] });
  await poller.pass();
  third.state = 'working';
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.channel), ['C0000000003']);
  const lists = s.stub.calls('bakers_ticket_list');
  assert.deepEqual(lists.slice(0, 2).map((a) => [a.project, a.offset ?? 0]), [[PROJECT, 0], [PROJECT, 2]]);
  assert.ok(s.stub.requests.every((r) => r.path === '/mcp'), 'no request outside the bakers tools');
});

test('only the first chat link is the thread', async (t) => {
  const { s, slack, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'plan', links: [{ uri: 'https://example.com/spec', title: 'Spec' }, thread('C0000000002'), thread('C0000000001', '1700000000.000900')] });
  await poller.pass();
  ticket.state = 'working';
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => [p.channel, p.thread_ts]), [['C0000000002', '1700000000.000100']]);
});

test('done adds the Manual review section of the newest summary, without reviewer-only lines', async (t) => {
  const { s, slack, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'review', links: [thread()] });
  s.addComment(ticket, { type: 'summary', created: '2026-11-02T09:00:00+00:00', body: '### 🧪 Manual review\n\nOld.' });
  s.addComment(ticket, {
    type: 'summary',
    created: '2026-11-02T11:00:00+00:00',
    body: '### Outcome\n\nDone.\n\n### 🧪 Manual review\n\nOpen the price list and check the 3 a.m. run.\n- https://bakers.example/user/reset/1/abc\n\n### Next action\n\nNone.',
  });
  await poller.pass();
  ticket.state = 'done';
  await poller.pass();
  assert.equal(slack.posts()[0].text, `${messages.states.done}\n\n${messages.testHint}\n\nOpen the price list and check the 3 a.m. run.`);
});

test('an open question is relayed into its thread exactly once, keyed by the comment', async (t) => {
  const { s, sent, poller, state } = await setup(t);
  const ticket = s.addTicket({ title: 'Price updater', state: 'working', links: [thread()] });
  s.addComment(ticket, { type: 'summary', created: '2026-11-02T09:59:00+00:00' });
  const question = frozenWithQuestion(s, ticket);
  await poller.pass();
  await poller.pass();
  assert.deepEqual(sent, [
    {
      question: question.id,
      identifier: 'ACME-1',
      channel: 'C0000000001',
      thread_ts: '1700000000.000100',
      text: 'The implementation of the "Price updater" ticket has a question:\n\nShould it run at 3 a.m.?',
    },
  ]);
  assert.deepEqual(state().relayed, [question.id]);
});

test('a failed relay is retried on the next pass and then sent once', async (t) => {
  const { s, sent, poller, failSend } = await setup(t);
  frozenWithQuestion(s, s.addTicket({ links: [thread()] }));
  failSend(true);
  await poller.pass();
  failSend(false);
  await poller.pass();
  await poller.pass();
  assert.equal(sent.length, 1);
});

test('a ticket without a chat link has no question relayed and no state posted', async (t) => {
  const { s, slack, sent, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'plan' });
  frozenWithQuestion(s, ticket);
  await poller.pass();
  ticket.state = 'working';
  await poller.pass();
  assert.deepEqual(sent, []);
  assert.deepEqual(slack.posts(), []);
});

test('a sub-ticket gets its own thread in the ancestor channel, its chat link and one pointer in the parent thread', async (t) => {
  const { s, slack, poller, state } = await setup(t);
  const parent = s.addTicket({ title: 'Price updater', links: [thread('C0000000002')] });
  const child = s.addTicket({ title: 'Nightly run', parent: parent.id });
  const grandchild = s.addTicket({ title: 'Retry', parent: child.id });
  await poller.pass();
  await poller.pass();
  const posts = slack.posts();
  assert.deepEqual(posts[0], { channel: 'C0000000002', text: 'ACME-2 · Nightly run (sub-ticket of ACME-1)' });
  const pointers = posts.filter((p) => p.thread_ts === '1700000000.000100');
  assert.equal(pointers.length, 1, 'one pointer in the parent thread');
  assert.equal(pointers[0].channel, 'C0000000002');
  assert.match(pointers[0].text, /^ACME-2 · Nightly run continues in its own thread: https:\/\/acme\.slack\.com\/archives\/C0000000002\/p1800000000000001$/);
  // The grandchild's nearest ancestor with a thread is the child, linked first in the same pass.
  assert.deepEqual(posts[1], { channel: 'C0000000002', text: 'ACME-3 · Retry (sub-ticket of ACME-2)' });
  assert.equal(posts.filter((p) => p.thread_ts === '1800000000.000001').length, 1, 'the grandchild pointer goes into the child thread');
  const link = child.links[0];
  assert.deepEqual([link.uri, link.title], ['https://acme.slack.com/archives/C0000000002/p1800000000000001', 'Slack thread']);
  assert.equal(grandchild.links.length, 1);
  assert.equal(posts.filter((p) => !p.thread_ts).length, 2, 'one thread each, no more');
  assert.equal(posts.length, 4);
  assert.deepEqual(state().threads['ACME-2'], { channel: 'C0000000002', ts: '1800000000.000001', permalink: link.uri, linked: true, pointed: true, parentChannel: 'C0000000002', parentTs: '1700000000.000100' });
});

test('a failed link write is retried from the recorded thread and never opens a second one', async (t) => {
  const { s, slack, poller, state } = await setup(t);
  const parent = s.addTicket({ links: [thread()] });
  const child = s.addTicket({ title: 'Nightly run', parent: parent.id });
  s.failOnce('bakers_ticket_transition');
  await poller.pass();
  assert.equal(state().threads['ACME-2'].linked, false);
  await poller.pass();
  assert.equal(state().threads['ACME-2'].linked, true);
  assert.equal(child.links.length, 1);
  assert.equal(slack.posts().filter((p) => !p.thread_ts).length, 1);
});
