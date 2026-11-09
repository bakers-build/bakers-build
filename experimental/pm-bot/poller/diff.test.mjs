import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, reachedDone } from './diff.mjs';

const messages = {
  states: {
    working: 'Work on this has started.',
    review: 'The work is finished and is being checked.',
    done: 'This is finished and ready for you to try.',
    cancelled: 'This was cancelled.',
  },
  testHint: 'Where and how to test:',
  noTestHint: 'The ticket does not say yet where or how to test this.',
};

const slackThread = { channel: 'C1', thread_ts: '1700000000.000100' };
const ticket = (identifier, state, conversation = slackThread, extra = {}) => ({ identifier, title: `Ticket ${identifier}`, state, conversation, ...extra });

test('the first run records every state and posts nothing', () => {
  const { posts, next } = diff(null, [ticket('ACME-1', 'plan'), ticket('ACME-2', 'working')], {}, messages);
  assert.deepEqual(posts, []);
  assert.deepEqual(next, { 'ACME-1': 'plan', 'ACME-2': 'working' });
});

test('a changed state posts its plain-words text into the ticket thread', () => {
  const { posts, next } = diff({ 'ACME-1': 'plan' }, [ticket('ACME-1', 'working')], {}, messages);
  assert.deepEqual(posts, [
    { identifier: 'ACME-1', channel: 'C1', thread_ts: '1700000000.000100', text: 'Work on this has started.' },
  ]);
  assert.deepEqual(next, { 'ACME-1': 'working' });
});

test('a ticket without a conversation is skipped', () => {
  const { posts, next } = diff({ 'ACME-1': 'plan' }, [ticket('ACME-1', 'working', null)], {}, messages);
  assert.deepEqual(posts, []);
  assert.deepEqual(next, {});
});

test('an unchanged state posts nothing', () => {
  const { posts } = diff({ 'ACME-1': 'working' }, [ticket('ACME-1', 'working')], {}, messages);
  assert.deepEqual(posts, []);
});

const summary = `### 🎯 Outcome

Built the daily schedule.

### 🧪 Manual review

Open https://preview.example.test/prices and check that the update ran today.

### ➡️ Next action

Approve the merge.
`;

test('done adds where and how to test from the latest summary', () => {
  const { posts } = diff({ 'ACME-1': 'review' }, [ticket('ACME-1', 'done')], { 'ACME-1': summary }, messages);
  assert.equal(posts.length, 1);
  assert.equal(
    posts[0].text,
    'This is finished and ready for you to try.\n\nWhere and how to test:\n\nOpen https://preview.example.test/prices and check that the update ran today.',
  );
});

test('done without a manual review section says that none is recorded', () => {
  const { posts } = diff({ 'ACME-1': 'review' }, [ticket('ACME-1', 'done')], { 'ACME-1': '### 🎯 Outcome\n\nDone.\n' }, messages);
  assert.equal(
    posts[0].text,
    'This is finished and ready for you to try.\n\nThe ticket does not say yet where or how to test this.',
  );
});

test('a ticket the poller has not seen before posts nothing while open, its final state once closed', () => {
  const { posts, next } = diff({ 'ACME-1': 'plan' }, [ticket('ACME-1', 'plan'), ticket('ACME-2', 'plan'), ticket('ACME-3', 'cancelled')], {}, messages);
  assert.deepEqual(posts.map((p) => [p.identifier, p.text]), [['ACME-3', messages.states.cancelled]]);
  assert.deepEqual(next, { 'ACME-1': 'plan', 'ACME-2': 'plan', 'ACME-3': 'cancelled' });
  assert.deepEqual(diff(null, [ticket('ACME-3', 'cancelled')], {}, messages).posts, [], 'the first run still posts nothing');
});

test('reachedDone names the tickets with a conversation that changed to done or are first seen done', () => {
  const tickets = [ticket('ACME-1', 'done'), ticket('ACME-2', 'done'), ticket('ACME-3', 'done', null), ticket('ACME-4', 'done')];
  assert.deepEqual(reachedDone({ 'ACME-1': 'review', 'ACME-2': 'done', 'ACME-3': 'review' }, tickets), ['ACME-1', 'ACME-4']);
  assert.deepEqual(reachedDone(null, tickets), []);
});

const reviewerSummary = `### 🎯 Outcome

Built the daily schedule.

### 🧪 Manual review

- \`north-lead\` ([one-time login](https://site.example.test/user/reset/12/1700000000/abc/login)): sees the daily schedule.

Open https://preview.example.test/prices and check that the update ran today.

🔗 [Merge request !53](https://git.example.test/team/app/-/merge_requests/53)

\`fbc5e8a → bca7d53\`

\`\`\`bash
cd web && drush cron
\`\`\`

### ➡️ Next action

Approve the merge.
`;

test('done leaves login links, merge requests, commit ranges and commands out of the test hint', () => {
  const { posts } = diff({ 'ACME-1': 'review' }, [ticket('ACME-1', 'done')], { 'ACME-1': reviewerSummary }, messages);
  assert.equal(
    posts[0].text,
    'This is finished and ready for you to try.\n\nWhere and how to test:\n\nOpen https://preview.example.test/prices and check that the update ran today.',
  );
});

test('done whose manual review holds only reviewer material says that none is recorded', () => {
  const internal = '### 🧪 Manual review\n\n🔗 [Merge request !53](https://git.example.test/team/app/-/merge_requests/53)\n\n`fbc5e8a → bca7d53`\n';
  const { posts } = diff({ 'ACME-1': 'review' }, [ticket('ACME-1', 'done')], { 'ACME-1': internal }, messages);
  assert.equal(
    posts[0].text,
    'This is finished and ready for you to try.\n\nThe ticket does not say yet where or how to test this.',
  );
});

test('a post into a channel conversation goes flat, without thread_ts', () => {
  const { posts } = diff({ 'ACME-1': 'plan' }, [ticket('ACME-1', 'working', { channel: 'C1' })], {}, messages);
  assert.deepEqual(posts, [{ identifier: 'ACME-1', channel: 'C1', text: 'Work on this has started.' }]);
});

test('a sub-ticket posts into its ancestor\'s conversation behind its identifier', () => {
  const { posts } = diff({ 'ACME-2': 'plan' }, [ticket('ACME-2', 'working', { channel: 'C1' }, { inherited: true })], {}, messages);
  assert.deepEqual(posts, [{ identifier: 'ACME-2', channel: 'C1', text: 'ACME-2 · Work on this has started.' }]);
});
