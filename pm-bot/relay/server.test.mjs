import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { createBakersClient } from '../lib/bakers-client.mjs';
import { createRelay } from './server.mjs';
import { PROJECT, site, thread } from '../test/site.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const CHANNEL = 'C0000000001';
const TS = '1700000000.000100';
const PERMALINK = `https://acme.slack.com/archives/${CHANNEL}/p1700000000000100`;

async function setup(t, { env = {}, failTools } = {}) {
  const s = await site({ failTools });
  t.after(s.close);
  const client = createBakersClient({ url: s.stub.url, clientId: 'key', clientSecret: 'secret' });
  const relay = createRelay({
    client,
    env: {
      PM_BOT_PROJECT: PROJECT,
      PM_BOT_TICKET_WORKFLOW: 'bb_work',
      PM_BOT_CONDUCTOR: 'conductor-uuid',
      SLACK_ALLOWED_CHANNELS: `${CHANNEL},C0000000002`,
      ...env,
    },
  });
  let id = 0;
  const call = async (name, args) => {
    const { result } = await relay.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
    const text = result.content[0].text;
    return { isError: result.isError, text, data: result.isError ? null : JSON.parse(text) };
  };
  return { s, relay, call };
}

const request = (overrides = {}) => ({
  title: 'Send the sales report daily',
  description: '## Request\n\n> Please send the sales report daily instead of weekly.',
  requester: 'Jane Doe',
  labels: [],
  channel: CHANNEL,
  thread_ts: TS,
  permalink: PERMALINK,
  ...overrides,
});

test('the relay lists exactly its four tools', async (t) => {
  const { relay } = await setup(t);
  const { result } = await relay.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), ['answer_question', 'create_ticket', 'ticket_read', 'ticket_search']);
});

test('create_ticket creates, sets the conductor, links the thread, in that order, with no type or recipe', async (t) => {
  const { s, call } = await setup(t);
  const { isError, data } = await call('create_ticket', request());
  assert.equal(isError, false);
  assert.equal(data.identifier, 'ACME-1');
  assert.deepEqual(data.steps, { create: 'ok', conductor: 'ok', labels: 'none requested', link: 'ok' });
  assert.deepEqual(s.stub.calls('bakers_ticket_create'), [
    {
      title: 'Send the sales report daily',
      workflow: 'bb_work',
      project: PROJECT,
      description: '## Request\n\n> Please send the sales report daily instead of weekly.\n\nRequested in Slack by Jane Doe.',
    },
  ]);
  const ticket = s.tickets[0];
  assert.equal(ticket.conductor, 'conductor-uuid');
  assert.deepEqual(ticket.links.map((l) => [l.uri, l.title]), [[PERMALINK, 'Slack thread']]);
  assert.deepEqual(
    s.log.filter((line) => line.startsWith('tool')),
    ['tool bakers_ticket_create', 'tool bakers_ticket_update', 'tool bakers_ticket_transition'],
  );
});

test('without PM_BOT_CONDUCTOR no conductor is set and the steps say so', async (t) => {
  const { s, call } = await setup(t, { env: { PM_BOT_CONDUCTOR: '' } });
  const { data } = await call('create_ticket', request());
  assert.equal(data.steps.conductor, 'not set: PM_BOT_CONDUCTOR is empty');
  assert.deepEqual(s.stub.calls('bakers_ticket_update'), []);
  assert.equal(s.tickets[0].conductor, undefined);
});

test('requested labels are added, and a missing one is created in the workspace first', async (t) => {
  const { s, call } = await setup(t);
  s.labels.push({ id: 'label-bug', name: 'customer' });
  const { data } = await call('create_ticket', request({ labels: ['customer', 'reporting'] }));
  assert.equal(data.steps.labels, 'ok');
  const created = s.labels.find((l) => l.name === 'reporting');
  assert.ok(created, 'the missing label was created');
  assert.deepEqual(s.tickets[0].labels, ['label-bug', created.id]);
});

test('a failing step after creation is reported, the identifier still returned', async (t) => {
  const { s, call } = await setup(t, { failTools: { bakers_ticket_transition: 'links refused' } });
  const { isError, data } = await call('create_ticket', request());
  assert.equal(isError, false);
  assert.equal(data.identifier, 'ACME-1');
  assert.match(data.steps.link, /^failed: .*links refused/);
  assert.equal(s.tickets.length, 1);
});

test('a failed creation is an error and nothing else is attempted', async (t) => {
  const { s, call } = await setup(t, { failTools: { bakers_ticket_create: 'project not found' } });
  const { isError, text } = await call('create_ticket', request());
  assert.equal(isError, true);
  assert.match(text, /project not found/);
  assert.deepEqual(s.stub.calls('bakers_ticket_update'), []);
});

test('create_ticket refuses a channel outside SLACK_ALLOWED_CHANNELS and a permalink of another thread', async (t) => {
  const { s, call } = await setup(t);
  assert.match((await call('create_ticket', request({ channel: 'C0000000099' }))).text, /channel/);
  assert.match((await call('create_ticket', request({ permalink: 'https://evil.example/archives/C0000000001/p1' }))).text, /permalink/);
  assert.match((await call('create_ticket', request({ thread_ts: 'yesterday' }))).text, /thread_ts/);
  assert.equal(s.tickets.length, 0);
});

function frozenTicket(s) {
  return s.addTicket({ title: 'Price updater', state: 'working', links: [thread()], labels: ['label-question'], frozen: true, frozen_at: '2026-11-02T10:00:00+00:00' });
}

test('answer_question posts the credited answer, removes the Question label and unfreezes', async (t) => {
  const { s, call } = await setup(t);
  const ticket = frozenTicket(s);
  ticket.labels.push('label-other');
  s.labels.push({ id: 'label-other', name: 'customer' });
  const { isError, data } = await call('answer_question', { ticket: 'ACME-1', text: 'Yes, at 3 a.m.', answerer: 'Max', channel: CHANNEL });
  assert.equal(isError, false);
  assert.deepEqual(data, { ticket: 'ACME-1', answered: true });
  assert.deepEqual(
    s.comments.map((c) => [c.ticket, c.type, c.body]),
    [[ticket.id, 'comment', 'Answered in Slack by Max:\n\nYes, at 3 a.m.']],
  );
  assert.equal(ticket.frozen, false);
  assert.deepEqual(ticket.labels, ['label-other']);
});

test('answer_question refuses a ticket that is not frozen or has no Question label, changing nothing', async (t) => {
  const { s, call } = await setup(t);
  s.addTicket({ links: [thread()], labels: ['label-question'], frozen: false });
  s.addTicket({ links: [thread()], labels: [], frozen: true });
  assert.match((await call('answer_question', { ticket: 'ACME-1', text: 'Yes', answerer: 'Max', channel: CHANNEL })).text, /not waiting for an answer/);
  assert.match((await call('answer_question', { ticket: 'ACME-2', text: 'Yes', answerer: 'Max', channel: CHANNEL })).text, /not waiting for an answer/);
  assert.deepEqual(s.comments, []);
});

test('answer_question refuses a channel outside SLACK_ALLOWED_CHANNELS', async (t) => {
  const { s, call } = await setup(t);
  frozenTicket(s);
  const { isError, text } = await call('answer_question', { ticket: 'ACME-1', text: 'Yes', answerer: 'Max', channel: 'C0000000099' });
  assert.equal(isError, true);
  assert.match(text, /channel/);
  assert.equal(s.tickets[0].frozen, true);
});

test('ticket_read and ticket_search pass through, the search scoped to the project', async (t) => {
  const { s, call } = await setup(t);
  s.addTicket({ title: 'Price updater' });
  assert.equal((await call('ticket_read', { ticket: 'ACME-1' })).data.identifier, 'ACME-1');
  assert.deepEqual((await call('ticket_search', { query: 'Price' })).data.tickets.map((x) => x.identifier), ['ACME-1']);
  assert.deepEqual(s.stub.calls('bakers_ticket_search'), [{ query: 'Price', project: PROJECT }]);
});

test('over stdio the server reads the env file its argument names and answers tools/call', async (t) => {
  const s = await site();
  t.after(s.close);
  const home = mkdtempSync(join(tmpdir(), 'pm-relay-'));
  writeFileSync(
    join(home, '.env'),
    [`BAKERS_URL=${s.stub.url}`, 'BAKERS_CLIENT_ID=key', 'BAKERS_CLIENT_SECRET=secret', `PM_BOT_PROJECT=${PROJECT}`, `SLACK_ALLOWED_CHANNELS=${CHANNEL}`].join('\n'),
  );
  s.addTicket({ title: 'Price updater' });
  // As the image runs it: from its own folder, with a filtered environment (Hermes').
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), join(home, '.env')], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const answers = new Map();
  const waiters = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    (waiters.get(message.id) ?? ((m) => answers.set(m.id, m)))(message);
  });
  const send = (message) =>
    new Promise((resolve) => {
      waiters.set(message.id, resolve);
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  const init = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.result.serverInfo.name, 'pm-relay');
  const read = await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ticket_read', arguments: { ticket: 'ACME-1' } } });
  assert.equal(JSON.parse(read.result.content[0].text).identifier, 'ACME-1');
});
