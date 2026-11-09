import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setup } from '../test/poller-setup.mjs';
import { channel, PROJECT, thread } from '../test/site.mjs';

const messages = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));

function frozenWithQuestion(s, ticket, body = 'Should it run at 3 a.m.?') {
  const question = s.addComment(ticket, { body, created: '2026-11-02T10:00:00+00:00' });
  Object.assign(ticket, { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['Question'] });
  return question;
}

function frozenWithTechnicalProblem(s, ticket, body = 'The test database refuses the connection. Please contact keytec.') {
  const note = s.addComment(ticket, { body, created: '2026-11-02T10:00:00+00:00' });
  Object.assign(ticket, { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['technical problem'] });
  return note;
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

test('without a channel link, only the first chat link is the thread', async (t) => {
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
      comment: question.id,
      kind: 'question',
      identifier: 'ACME-1',
      channel: 'C0000000001',
      thread_ts: '1700000000.000100',
      text: 'ACME-1 · "Price updater" has a question:\n\nShould it run at 3 a.m.?',
    },
  ]);
  assert.deepEqual(state().relayed, [question.id]);
});

test('a technical problem is relayed into its thread exactly once, behind its own lead-in', async (t) => {
  const { s, sent, poller, state } = await setup(t);
  const ticket = s.addTicket({ title: 'Price updater', state: 'working', links: [thread()] });
  const note = frozenWithTechnicalProblem(s, ticket);
  await poller.pass();
  await poller.pass();
  assert.deepEqual(sent, [
    {
      comment: note.id,
      kind: 'technical_problem',
      identifier: 'ACME-1',
      channel: 'C0000000001',
      thread_ts: '1700000000.000100',
      text: 'The work on the "Price updater" ticket is stuck on a technical problem that keytec has to solve:\n\nThe test database refuses the connection. Please contact keytec.',
    },
  ]);
  assert.deepEqual(state().relayed, [note.id]);
});

test('a ticket labelled Question and technical problem gets only the technical-problem post', async (t) => {
  const { s, sent, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'working', links: [thread()] });
  frozenWithTechnicalProblem(s, ticket);
  ticket.labels = ['Question', 'technical problem'];
  await poller.pass();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'technical_problem');
  assert.ok(!sent[0].text.includes('has a question:'));
});

test('a technical problem is not posted again by a restarted poller', async (t) => {
  const { s, sent, poller, restart } = await setup(t);
  frozenWithTechnicalProblem(s, s.addTicket({ state: 'working', links: [thread()] }));
  await poller.pass();
  await restart().pass();
  assert.equal(sent.length, 1);
});

test('a question and a technical problem open at once are each relayed once', async (t) => {
  const { s, sent, poller, state } = await setup(t);
  const question = frozenWithQuestion(s, s.addTicket({ state: 'working', links: [thread()] }));
  const note = frozenWithTechnicalProblem(s, s.addTicket({ state: 'working', links: [thread('C0000000002')] }));
  await poller.pass();
  await poller.pass();
  await poller.pass();
  assert.equal(sent.length, 2);
  assert.deepEqual([...state().relayed].sort(), [question.id, note.id].sort());
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

test('a ticket without a conversation has no question relayed and no state posted', async (t) => {
  const { s, slack, sent, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'plan' });
  frozenWithQuestion(s, ticket);
  await poller.pass();
  ticket.state = 'working';
  await poller.pass();
  assert.deepEqual(sent, []);
  assert.deepEqual(slack.posts(), []);
});

const DAY = 24 * 3600 * 1000;
const requestChannel = (created = '2026-11-05T11:00:00Z') => ({ C0000000001: { name: 'req-comic-sans', requester: 'U0000000007', created } });

test('a sub-ticket posts into its ancestor\'s channel behind its identifier, and no thread is ever opened', async (t) => {
  const { s, slack, sent, poller } = await setup(t);
  const parent = s.addTicket({ title: 'Price updater', state: 'working', links: [channel()] });
  const child = s.addTicket({ title: 'Nightly run', state: 'plan', parent: parent.id });
  frozenWithQuestion(s, s.addTicket({ title: 'Retry', state: 'working', parent: child.id }));
  await poller.pass();
  child.state = 'working';
  await poller.pass();
  assert.deepEqual(slack.posts(), [{ channel: 'C0000000001', text: `ACME-2 · ${messages.states.working}` }]);
  assert.deepEqual(sent.map((m) => [m.channel, 'thread_ts' in m, m.text]), [['C0000000001', false, 'ACME-3 · "Retry" has a question:\n\nShould it run at 3 a.m.?']]);
  assert.equal(slack.calls.filter((c) => c.method === 'chat.getPermalink').length, 0);
  assert.deepEqual(s.stub.calls('bakers_ticket_transition'), []);
});

test('a linked request channel is renamed after its ticket, with -2 when the name is taken', async (t) => {
  const { s, slack, poller, botChannels, state } = await setup(t);
  botChannels(requestChannel());
  slack.take('acme-1-comic-sans');
  s.addTicket({ title: 'Comic Sans', state: 'qualification', links: [channel()] });
  await poller.pass();
  await poller.pass();
  const renames = slack.calls.filter((c) => c.method === 'conversations.rename').map((c) => c.body);
  assert.deepEqual(renames, [
    { channel: 'C0000000001', name: 'acme-1-comic-sans' },
    { channel: 'C0000000001', name: 'acme-1-comic-sans-2' },
  ]);
  assert.deepEqual(state().channels.C0000000001, { ticket: 'ACME-1', requester: 'U0000000007', name: 'acme-1-comic-sans-2', generation: 2, renamed: true });
});

test('done is posted, then the channel archived; a failed archive retries only the archive', async (t) => {
  const { s, slack, poller, botChannels, state } = await setup(t);
  botChannels(requestChannel());
  const ticket = s.addTicket({ title: 'Comic Sans', state: 'review', links: [channel()] });
  await poller.pass();
  ticket.state = 'done';
  slack.fail('conversations.archive');
  await poller.pass();
  slack.heal();
  await poller.pass();
  await poller.pass();
  const order = slack.calls.filter((c) => ['chat.postMessage', 'conversations.archive'].includes(c.method)).map((c) => c.method);
  assert.deepEqual(order, ['chat.postMessage', 'conversations.archive', 'conversations.archive']);
  assert.match(slack.posts()[0].text, /^This is finished and ready for you to try\./);
  assert.equal(state().channels.C0000000001.archived, true);
});

test('cancelled archives the channel after its post', async (t) => {
  const { s, slack, poller, botChannels } = await setup(t);
  botChannels(requestChannel());
  const ticket = s.addTicket({ state: 'working', links: [channel()] });
  await poller.pass();
  ticket.state = 'cancelled';
  await poller.pass();
  assert.deepEqual(slack.calls.filter((c) => ['chat.postMessage', 'conversations.archive'].includes(c.method)).map((c) => c.method), ['chat.postMessage', 'conversations.archive']);
});

test('a ticket first seen as cancelled gets its final post before the archive', async (t) => {
  const { s, slack, poller, botChannels } = await setup(t);
  botChannels(requestChannel());
  await poller.pass();
  s.addTicket({ state: 'cancelled', links: [channel()] });
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.calls.filter((c) => ['chat.postMessage', 'conversations.archive'].includes(c.method)).map((c) => c.method), ['chat.postMessage', 'conversations.archive']);
  assert.equal(slack.posts()[0].text, messages.states.cancelled);
});

test('a reopened ticket gets a fresh channel with the requester, a link back and its state, once', async (t) => {
  const { s, slack, poller, botChannels, restart, state } = await setup(t);
  botChannels(requestChannel());
  const ticket = s.addTicket({ title: 'Comic Sans', state: 'review', links: [channel()] });
  await poller.pass();
  ticket.state = 'done';
  await poller.pass();
  ticket.state = 'working';
  s.failOnce('bakers_ticket_transition');
  await poller.pass();
  await restart().pass();
  await poller.pass();
  const created = slack.calls.filter((c) => c.method === 'conversations.create').map((c) => c.body.name);
  assert.deepEqual(created, ['acme-1-comic-sans-2']);
  const fresh = state().channels.C0000000001.reopened;
  assert.equal(state().channels[fresh].previous, 'C0000000001');
  assert.deepEqual(slack.calls.filter((c) => c.method === 'conversations.invite').map((c) => c.body), [{ channel: fresh, users: 'U0000000007' }]);
  const reopenPosts = slack.posts().filter((p) => p.channel === fresh);
  assert.deepEqual(reopenPosts, [{ channel: fresh, text: `${messages.states.working}\n\n${messages.reopened.replace('{previous}', '<#C0000000001>')}` }]);
  assert.deepEqual(ticket.links.at(-1), { uri: `https://acme.slack.com/archives/${fresh}`, title: 'Slack channel' });
  assert.equal(slack.posts().length, 2, 'the done post and the reopen post, nothing twice');
  // From now on the fresh channel is the ticket's conversation.
  ticket.state = 'review';
  await poller.pass();
  assert.deepEqual(slack.posts().at(-1), { channel: fresh, text: messages.states.review });
});

test('a reopen channel whose link was stored but whose reply was lost is still admitted and archived', async (t) => {
  const { s, slack, poller, botChannels, state } = await setup(t);
  botChannels(requestChannel());
  const ticket = s.addTicket({ title: 'Comic Sans', state: 'review', links: [channel()] });
  await poller.pass();
  ticket.state = 'done';
  await poller.pass();
  ticket.state = 'working';
  s.loseReplyOnce('bakers_ticket_transition');
  await poller.pass();
  assert.equal(slack.calls.filter((c) => c.method === 'conversations.create').length, 1);
  const id = ticket.links.at(-1).uri.split('/').pop();
  assert.equal(state().channels[id]?.ticket, 'ACME-1', 'the fresh channel is recorded, so the plugin admits it');
  ticket.state = 'done';
  await poller.pass();
  await poller.pass();
  const archives = slack.calls.filter((c) => c.method === 'conversations.archive').map((c) => c.body.channel);
  assert.deepEqual(archives, ['C0000000001', id]);
});

test('a request channel without a ticket is closed after 7 silent days, not after 6', async (t) => {
  const { slack, poller, botChannels, clock, state } = await setup(t, {
    // The last message: 6 days before the test's start.
    slackAnswers: { 'conversations.history': { ok: true, messages: [{ ts: String((Date.parse('2026-11-05T12:00:00Z') - 6 * DAY) / 1000) }] } },
  });
  botChannels(requestChannel(new Date(clock.now - 10 * DAY).toISOString()));
  await poller.pass();
  assert.deepEqual(slack.posts(), [], 'a message 6 days ago keeps it open');
  clock.now += DAY;
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts(), [{ channel: 'C0000000001', text: messages.abandoned }]);
  assert.equal(slack.calls.filter((c) => c.method === 'conversations.archive').length, 1);
  assert.equal(state().channels.C0000000001.archived, true);
});

test('a channel link to a channel the bot did not create is posted to, never renamed or archived', async (t) => {
  const { s, slack, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'review', links: [channel('C0000000005')] });
  await poller.pass();
  ticket.state = 'done';
  await poller.pass();
  assert.equal(slack.posts().length, 1);
  assert.deepEqual(slack.calls.filter((c) => c.method.startsWith('conversations.')), []);
});

const MINUTE = 60 * 1000;

test('a ticket walking plan, working, review and done gets its state lines, a work-start line, a line per summary and the preview link, in order', async (t) => {
  const { s, slack, poller, clock } = await setup(t);
  const ticket = s.addTicket({ state: 'plan', links: [thread()] });
  s.addComment(ticket, { type: 'summary', body: '### Outcome\n\nThe request is written up.', created: '2026-11-05T11:00:00Z' });
  await poller.pass();

  ticket.state = 'working';
  const working = s.addRun(ticket, { state_at_start: 'working' });
  await poller.pass();

  clock.now += 20 * MINUTE;
  s.addComment(ticket, { type: 'summary', body: '### 🎯 Outcome\n\nThe import reads the **supplier** file. Prices update every night.', created: '2026-11-05T12:19:00Z' });
  ticket.links.push({ uri: 'https://acme-1.ddev.site/prices', title: 'Price list' });
  working.state = 'done';
  ticket.state = 'review';
  const review = s.addRun(ticket, { state_at_start: 'review' });
  await poller.pass();

  clock.now += 10 * MINUTE;
  s.addComment(ticket, { type: 'summary', body: '### Outcome\n\nAll checks pass.\n\n### 🧪 Manual review\n\nOpen the price list.', created: '2026-11-05T12:29:00Z' });
  review.state = 'done';
  ticket.state = 'done';
  await poller.pass();
  await poller.pass();

  assert.deepEqual(slack.posts().map((p) => p.text), [
    messages.states.working,
    messages.runStart.working,
    messages.states.review,
    'The import reads the supplier file. Prices update every night.',
    `${messages.previewLead} Price list\nhttps://acme-1.ddev.site/prices`,
    messages.runStart.review,
    `${messages.states.done}\n\n${messages.testHint}\n\nOpen the price list.`,
  ]);
});

test('runs, summaries and links from before the poller followed a ticket are not posted', async (t) => {
  const { s, slack, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'working', links: [thread(), { uri: 'https://acme-1.ddev.site/', title: 'Site' }] });
  s.addRun(ticket, { state: 'failed' });
  s.addRun(ticket);
  s.addComment(ticket, { type: 'summary', body: '### Outcome\n\nSomething was done earlier.' });
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts(), []);
});

test('a status line Slack refused is posted on a later pass, once, also after a restart', async (t) => {
  const { s, slack, poller, restart } = await setup(t);
  const ticket = s.addTicket({ state: 'working', links: [thread()] });
  await poller.pass();
  s.addRun(ticket);
  slack.fail('chat.postMessage');
  await poller.pass();
  slack.heal();
  const refused = slack.posts().length;
  const again = restart();
  await again.pass();
  await again.pass();
  assert.deepEqual(slack.posts().slice(refused).map((p) => p.text), [messages.runStart.working]);
});

test('a ticket whose runs cannot be read is skipped for the pass and caught up on the next', async (t) => {
  const { s, slack, poller } = await setup(t);
  const ticket = s.addTicket({ state: 'working', links: [thread()] });
  await poller.pass();
  s.addRun(ticket);
  s.failOnce('bakers_ticket_runs_list');
  await poller.pass();
  assert.deepEqual(slack.posts(), []);
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.text), [messages.runStart.working]);
});

test('a working ticket in a quiet conversation gets one heartbeat per interval while its run runs', async (t) => {
  const { s, slack, poller, clock } = await setup(t);
  const ticket = s.addTicket({ state: 'working', links: [thread()] });
  const running = s.addRun(ticket, { started_at: clock.now / 1000 - 3600 });
  await poller.pass();
  clock.now += 30 * MINUTE - 1;
  await poller.pass();
  assert.deepEqual(slack.posts(), []);
  clock.now += 1;
  await poller.pass();
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.text), [messages.stillWorking]);
  clock.now += 30 * MINUTE;
  running.state = 'done';
  ticket.state = 'review';
  await poller.pass();
  clock.now += 30 * MINUTE;
  await poller.pass();
  assert.deepEqual(slack.posts().map((p) => p.text), [messages.stillWorking, messages.states.review]);
});
