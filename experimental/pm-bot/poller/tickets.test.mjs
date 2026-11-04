import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatThread, pendingSubTickets } from './tickets.mjs';

const slack = (channel, p, kind = 'chat') => ({ uri: `https://acme.slack.com/archives/${channel}/p${p}`, title: 'Slack thread', options: kind ? { bakers: { kind } } : [] });

test('the first chat link gives the channel and thread_ts', () => {
  const links = [
    { uri: 'https://git.example.com/g/p/-/merge_requests/1', title: 'MR', options: { bakers: { kind: 'mr' } } },
    slack('C0000000001', '1700000000000100'),
    slack('C0000000002', '1700000000000200'),
  ];
  assert.deepEqual(chatThread(links), { channel: 'C0000000001', thread_ts: '1700000000.000100', url: links[1].uri });
});

test('a link stored without a kind is recognised by its permalink shape', () => {
  assert.deepEqual(chatThread([slack('C0000000001', '1700000000000100', null)]), {
    channel: 'C0000000001',
    thread_ts: '1700000000.000100',
    url: 'https://acme.slack.com/archives/C0000000001/p1700000000000100',
  });
});

test('a permalink to a reply names its thread through thread_ts', () => {
  const link = { uri: 'https://acme.slack.com/archives/C0000000001/p1700000000000200?thread_ts=1700000000.000100&cid=C0000000001', options: { bakers: { kind: 'chat' } } };
  assert.equal(chatThread([link]).thread_ts, '1700000000.000100');
});

test('no chat link, or one that is not a Slack permalink, is no thread', () => {
  assert.equal(chatThread([]), null);
  assert.equal(chatThread([{ uri: 'https://example.com/spec', options: { bakers: { kind: 'doc' } } }]), null);
  assert.equal(chatThread([{ uri: 'https://example.com/chat', options: { bakers: { kind: 'chat' } } }]), null);
});

const t = (id, { thread = null, parent = null, closed = false } = {}) => ({ id, identifier: `ACME-${id}`, title: `Ticket ${id}`, thread, parent, closed });
const th = { channel: 'C1', thread_ts: '1700000000.000100', url: 'u' };

test('an open sub-ticket without a thread gets the nearest ancestor with one', () => {
  const tickets = [t('1', { thread: th }), t('2', { parent: '1' }), t('3', { parent: '2' }), t('4')];
  assert.deepEqual(
    pendingSubTickets(tickets).map((p) => [p.ticket.id, p.parent.id, p.ancestor.id]),
    [
      ['2', '1', '1'],
      ['3', '2', '1'],
    ],
  );
});

test('closed sub-tickets, threaded ones and orphans are left alone', () => {
  const tickets = [t('1', { thread: th, closed: true }), t('2', { parent: '1', closed: true }), t('3', { parent: '1', thread: th }), t('5', { parent: 'missing' })];
  assert.deepEqual(pendingSubTickets(tickets), []);
});
