import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversation, conversations } from './tickets.mjs';

const slack = (channel, p, kind = 'chat') => ({ uri: `https://acme.slack.com/archives/${channel}/p${p}`, title: 'Slack thread', options: kind ? { bakers: { kind } } : [] });

test('the first chat link gives the channel and thread_ts', () => {
  const links = [
    { uri: 'https://git.example.com/g/p/-/merge_requests/1', title: 'MR', options: { bakers: { kind: 'mr' } } },
    slack('C0000000001', '1700000000000100'),
    slack('C0000000002', '1700000000000200'),
  ];
  assert.deepEqual(conversation(links), { channel: 'C0000000001', thread_ts: '1700000000.000100', url: links[1].uri });
});

test('a link stored without a kind is recognised by its permalink shape', () => {
  assert.deepEqual(conversation([slack('C0000000001', '1700000000000100', null)]), {
    channel: 'C0000000001',
    thread_ts: '1700000000.000100',
    url: 'https://acme.slack.com/archives/C0000000001/p1700000000000100',
  });
});

test('a permalink to a reply names its thread through thread_ts', () => {
  const link = { uri: 'https://acme.slack.com/archives/C0000000001/p1700000000000200?thread_ts=1700000000.000100&cid=C0000000001', options: { bakers: { kind: 'chat' } } };
  assert.equal(conversation([link]).thread_ts, '1700000000.000100');
});

test('no chat link, or one that is not a Slack permalink, is no thread', () => {
  assert.equal(conversation([]), null);
  assert.equal(conversation([{ uri: 'https://example.com/spec', options: { bakers: { kind: 'doc' } } }]), null);
  assert.equal(conversation([{ uri: 'https://example.com/chat', options: { bakers: { kind: 'chat' } } }]), null);
});

const channel = (id, kind = 'chat') => ({ uri: `https://acme.slack.com/archives/${id}`, title: 'Slack channel', options: kind ? { bakers: { kind } } : [] });

test('the newest Slack channel link is the conversation, flat, ahead of an older thread', () => {
  const links = [slack('C0000000001', '1700000000000100'), channel('C0000000002'), channel('C0000000003')];
  assert.deepEqual(conversation(links), { channel: 'C0000000003', url: 'https://acme.slack.com/archives/C0000000003' });
});

test('a ticket with only a thread link keeps its thread', () => {
  const links = [slack('C0000000001', '1700000000000100')];
  assert.equal(conversation(links).thread_ts, '1700000000.000100');
});

const t = (id, { links = [], parent = null } = {}) => ({ id, identifier: `ACME-${id}`, parent, conversation: conversation(links) });

test('a sub-ticket without a conversation uses its nearest ancestor\'s, marked as inherited', () => {
  const tickets = [t('1', { links: [channel('C0000000001')] }), t('2', { parent: '1' }), t('3', { parent: '2' }), t('4'), t('5', { parent: 'missing' })];
  conversations(tickets);
  assert.deepEqual(tickets.map((x) => [x.conversation?.channel ?? null, Boolean(x.inherited)]), [
    ['C0000000001', false],
    ['C0000000001', true],
    ['C0000000001', true],
    [null, false],
    [null, false],
  ]);
});

test('a sub-ticket with its own conversation keeps it', () => {
  const tickets = [t('1', { links: [channel('C0000000001')] }), t('2', { parent: '1', links: [slack('C0000000001', '1700000000000200')] })];
  conversations(tickets);
  assert.deepEqual([tickets[1].conversation.thread_ts, Boolean(tickets[1].inherited)], ['1700000000.000200', false]);
});
