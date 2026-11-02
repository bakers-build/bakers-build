import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openQuestion, relay } from './questions.mjs';

const lead = 'The implementation of the "{title}" ticket has a question:';
const frozen = { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['Question'] };
const comment = (id, type, created, body = `Body ${id}`) => ({ id, type, created, body });

test('the open question is the newest non-summary comment at or before frozen_at', () => {
  const comments = [
    comment('c-1', 'comment', '2026-11-02T09:00:00+00:00'),
    comment('c-2', 'comment', '2026-11-02T10:00:00+00:00', 'Should it run at 3 a.m.?'),
    comment('c-3', 'summary', '2026-11-02T09:59:00+00:00'),
    comment('c-4', 'comment', '2026-11-02T10:00:01+00:00'),
  ];
  assert.deepEqual(openQuestion(frozen, comments), comments[1]);
});

test('a summary written just before freezing is never the question', () => {
  const comments = [comment('c-1', 'comment', '2026-11-02T08:00:00+00:00'), comment('c-2', 'summary', '2026-11-02T09:59:59+00:00')];
  assert.equal(openQuestion(frozen, comments).id, 'c-1');
});

test('a ticket that is not frozen or lacks the Question label has no open question', () => {
  const comments = [comment('c-1', 'comment', '2026-11-02T09:00:00+00:00')];
  assert.equal(openQuestion({ ...frozen, frozen: false }, comments), null);
  assert.equal(openQuestion({ ...frozen, labels: ['customer'] }, comments), null);
  assert.equal(openQuestion(frozen, []), null);
});

const ticket = { identifier: 'ACME-1', title: 'Price <updater> & $& co', thread: { channel: 'C1', thread_ts: '1700000000.000100' } };

test('an open question is posted behind the lead-in into the ticket thread, with Slack markup escaped', () => {
  const { posts } = relay([], [{ ticket, question: comment('c-2', 'comment', '', 'Run at <!channel> 3 a.m.?') }], true, lead);
  assert.deepEqual(posts, [
    {
      question: 'c-2',
      identifier: 'ACME-1',
      channel: 'C1',
      thread_ts: '1700000000.000100',
      text: 'The implementation of the "Price &lt;updater&gt; &amp; $&amp; co" ticket has a question:\n\nRun at &lt;!channel&gt; 3 a.m.?',
    },
  ]);
});

test('a question relayed before is not posted again', () => {
  const { posts, relayed } = relay(['c-2'], [{ ticket, question: comment('c-2', 'comment', '') }], true, lead);
  assert.deepEqual(posts, []);
  assert.deepEqual(relayed, ['c-2']);
});

test('answered questions are dropped from the record only when every ticket was read', () => {
  assert.deepEqual(relay(['c-1', 'c-2'], [{ ticket, question: comment('c-2', 'comment', '') }], true, lead).relayed, ['c-2']);
  assert.deepEqual(relay(['c-1', 'c-2'], [], false, lead).relayed, ['c-1', 'c-2']);
});
