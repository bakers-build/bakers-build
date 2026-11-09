import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openNote, relay } from './questions.mjs';

const texts = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));
const messages = texts.de;
const leads = {
  question: '{identifier} · "{title}" has a question:',
  technical_problem: 'The work on the "{title}" ticket is stuck on a technical problem that keytec has to solve:',
};
const frozen = { frozen: true, frozen_at: '2026-11-02T10:00:00+00:00', labels: ['Question'] };
const technical = { ...frozen, labels: ['technical problem'] };
const comment = (id, type, created, body = `Body ${id}`) => ({ id, type, created, body });
const ruleComments = () => [
  comment('c-1', 'comment', '2026-11-02T09:00:00+00:00'),
  comment('c-2', 'comment', '2026-11-02T10:00:00+00:00', 'Should it run at 3 a.m.?'),
  comment('c-3', 'summary', '2026-11-02T09:59:00+00:00'),
  comment('c-4', 'comment', '2026-11-02T10:00:01+00:00'),
];

test('the open question is the newest non-summary comment at or before frozen_at', () => {
  const comments = ruleComments();
  assert.deepEqual(openNote(frozen, comments), { kind: 'question', comment: comments[1] });
});

test('a summary written just before freezing is never the question', () => {
  const comments = [comment('c-1', 'comment', '2026-11-02T08:00:00+00:00'), comment('c-2', 'summary', '2026-11-02T09:59:59+00:00')];
  assert.equal(openNote(frozen, comments).comment.id, 'c-1');
});

test('a ticket that is not frozen or lacks the Question label has no open question', () => {
  const comments = [comment('c-1', 'comment', '2026-11-02T09:00:00+00:00')];
  assert.equal(openNote({ ...frozen, frozen: false }, comments), null);
  assert.equal(openNote({ ...frozen, labels: ['customer'] }, comments), null);
  assert.equal(openNote(frozen, []), null);
});

test('a frozen technical problem\'s note is chosen by the question rule', () => {
  const comments = ruleComments();
  assert.deepEqual(openNote(technical, comments), { kind: 'technical_problem', comment: comments[1] });
});

test('a ticket with both labels has a technical problem, not a question', () => {
  const note = openNote({ ...frozen, labels: ['Question', 'technical problem'] }, ruleComments());
  assert.equal(note.kind, 'technical_problem');
});

test('a technical problem that is not frozen has no note', () => {
  assert.equal(openNote({ ...technical, frozen: false }, ruleComments()), null);
});

const ticket = { identifier: 'ACME-1', title: 'Price <updater> & $& co', conversation: { channel: 'C1', thread_ts: '1700000000.000100' } };
const question = (c) => ({ kind: 'question', comment: c });
const problem = (c) => ({ kind: 'technical_problem', comment: c });

test('an open question is posted behind a lead-in naming the ticket by identifier and title, with Slack markup escaped', () => {
  const { posts } = relay([], [{ ticket, note: question(comment('c-2', 'comment', '', 'Run at <!channel> 3 a.m.?')) }], true, leads);
  assert.deepEqual(posts, [
    {
      comment: 'c-2',
      kind: 'question',
      identifier: 'ACME-1',
      channel: 'C1',
      thread_ts: '1700000000.000100',
      text: 'ACME-1 · "Price &lt;updater&gt; &amp; $&amp; co" has a question:\n\nRun at &lt;!channel&gt; 3 a.m.?',
    },
  ]);
});

test('a technical problem is posted behind its own lead-in, with Slack markup escaped', () => {
  const { posts } = relay([], [{ ticket, note: problem(comment('c-5', 'comment', '', 'Call <!here> & keytec')) }], true, leads);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, 'technical_problem');
  assert.equal(posts[0].comment, 'c-5');
  assert.equal(
    posts[0].text,
    'The work on the "Price &lt;updater&gt; &amp; $&amp; co" ticket is stuck on a technical problem that keytec has to solve:\n\nCall &lt;!here&gt; &amp; keytec',
  );
});

test('a question relayed before is not posted again', () => {
  const { posts, relayed } = relay(['c-2'], [{ ticket, note: question(comment('c-2', 'comment', '')) }], true, leads);
  assert.deepEqual(posts, []);
  assert.deepEqual(relayed, ['c-2']);
});

test('answered questions are dropped from the record only when every ticket was read', () => {
  assert.deepEqual(relay(['c-1', 'c-2'], [{ ticket, note: question(comment('c-2', 'comment', '')) }], true, leads).relayed, ['c-2']);
  assert.deepEqual(relay(['c-1', 'c-2'], [], false, leads).relayed, ['c-1', 'c-2']);
});

test('open questions and technical problems share the relayed record', () => {
  const open = [
    { ticket, note: question(comment('c-1', 'comment', '')) },
    { ticket: { ...ticket, identifier: 'ACME-2' }, note: problem(comment('c-2', 'comment', '')) },
  ];
  const { posts, relayed } = relay(['c-1', 'c-2'], open, true, leads);
  assert.deepEqual(posts, []);
  assert.deepEqual(relayed, ['c-1', 'c-2']);
  assert.deepEqual(relay(['c-1', 'c-2'], [], false, leads).relayed, ['c-1', 'c-2']);
});

test('the lead-in in messages.json is the agreed text', () => {
  assert.equal(texts.en.technicalProblemLead, 'The work on the "{title}" ticket is stuck on a technical problem that keytec has to solve:');
  assert.equal(texts.de.technicalProblemLead, 'Die Arbeit am Ticket „{title}“ hängt an einem technischen Problem, das keytec lösen muss:');
});

test('a note goes flat into a channel conversation; a sub-ticket\'s technical problem names the sub-ticket', () => {
  const sub = { identifier: 'ACME-2', title: 'Retry', conversation: { channel: 'C1' }, inherited: true };
  const { posts } = relay([], [{ ticket: sub, note: question(comment('c-1', 'comment', '', 'Why?')) }, { ticket: sub, note: problem(comment('c-2', 'comment', '', 'Down.')) }], true, leads);
  assert.deepEqual(posts.map((p) => [p.channel, 'thread_ts' in p, p.text]), [
    ['C1', false, 'ACME-2 · "Retry" has a question:\n\nWhy?'],
    ['C1', false, 'ACME-2 · The work on the "Retry" ticket is stuck on a technical problem that keytec has to solve:\n\nDown.'],
  ]);
});
