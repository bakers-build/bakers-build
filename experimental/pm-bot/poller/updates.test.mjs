import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { forget, updates } from './updates.mjs';

const messages = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-05T12:00:00Z');
const MIN = 60 * 1000;
const INTERVAL = 30 * MIN;
const where = { channel: 'C0000000001' };

const run = (id, state, at = 'working', started = NOW / 1000 - 60) => ({ uuid: id, state, state_at_start: at, started_at: started, closed: !['claimed', 'running'].includes(state) });
const summary = (id, body, created = '2026-11-05T11:59:00Z') => ({ id, type: 'summary', created, body });
const ticket = (fields = {}) => ({ identifier: 'ACME-1', state: 'working', labels: [], conversation: where, links: [], runs: [], comments: [], ...fields });
const seen = { runs: {}, summaries: [], links: [], lastStart: null };
// A pass after the ticket was first seen, with the conversation's last post `quiet` ago.
const pass = (tickets, { previous = { 'ACME-1': seen }, quiet = 0, now = NOW } = {}) =>
  updates({ previous, posted: { C0000000001: now - quiet }, tickets, now, interval: INTERVAL, messages });
const texts = (result) => result.posts.map((p) => p.text);

test('a ticket seen the first time records its runs, summaries and links and posts nothing', () => {
  const t = ticket({
    runs: [run('r2', 'running'), run('r1', 'failed')],
    comments: [summary('c1', '### Outcome\n\nThe price list is updated.')],
    links: [{ uri: 'https://acme-135.ddev.site/prices', title: 'Price list' }],
  });
  const result = updates({ previous: {}, posted: {}, tickets: [t], now: NOW, interval: INTERVAL, messages });
  assert.deepEqual(result.posts, []);
  assert.deepEqual(result.next.records['ACME-1'], { runs: { r2: 'running', r1: 'failed' }, summaries: ['c1'], links: ['https://acme-135.ddev.site/prices'], lastStart: null });
  assert.deepEqual(result.next.posted, { C0000000001: NOW });
});

test('a new run posts the start line of the state it starts in, once', () => {
  const first = pass([ticket({ runs: [run('r1', 'running', 'working')] })]);
  assert.deepEqual(first.posts, [{ identifier: 'ACME-1', channel: 'C0000000001', text: messages.runStart.working, run: ['r1', undefined], lastStart: null }]);
  const again = pass([ticket({ runs: [run('r1', 'running', 'working')] })], { previous: first.next.records });
  assert.deepEqual(again.posts, []);
  for (const state of ['qualification', 'plan', 'review']) {
    assert.deepEqual(texts(pass([ticket({ state, runs: [run('r1', 'claimed', state)] })])), [messages.runStart[state]]);
  }
});

test('a run starting within 5 minutes of the last posted start is recorded but not posted', () => {
  const recent = { ...seen, lastStart: NOW - 4 * MIN };
  const collapsed = pass([ticket({ runs: [run('r2', 'running')] })], { previous: { 'ACME-1': recent } });
  assert.deepEqual(collapsed.posts, []);
  assert.equal(collapsed.next.records['ACME-1'].runs.r2, 'running');
  const later = pass([ticket({ runs: [run('r2', 'running')] })], { previous: { 'ACME-1': { ...seen, lastStart: NOW - 6 * MIN } } });
  assert.deepEqual(texts(later), [messages.runStart.working]);
  assert.equal(later.next.records['ACME-1'].lastStart, NOW);
});

test('a run that ends failed, expired or cancelled in the same state posts the paused line once', () => {
  for (const end of ['failed', 'expired', 'cancelled']) {
    const result = pass([ticket({ runs: [run('r1', end)] })], { previous: { 'ACME-1': { ...seen, runs: { r1: 'running' } } } });
    assert.deepEqual(result.posts, [{ identifier: 'ACME-1', channel: 'C0000000001', text: messages.runPaused, run: ['r1', 'running'] }]);
    assert.deepEqual(pass([ticket({ runs: [run('r1', end)] })], { previous: result.next.records }).posts, []);
  }
});

test('a run that ends done in the same state posts the waiting line, unless a question or technical problem is open', () => {
  const previous = { 'ACME-1': { ...seen, runs: { r1: 'running' } } };
  assert.deepEqual(texts(pass([ticket({ runs: [run('r1', 'done')] })], { previous })), [messages.runWaiting]);
  for (const label of ['Question', 'technical problem']) {
    assert.deepEqual(pass([ticket({ labels: [label], runs: [run('r1', 'done')] })], { previous }).posts, []);
  }
});

test('a run whose ticket changed state posts no end line; the state line says it', () => {
  const previous = { 'ACME-1': { ...seen, runs: { r1: 'running' } } };
  assert.deepEqual(pass([ticket({ state: 'review', runs: [run('r1', 'done', 'working')] })], { previous }).posts, []);
  assert.deepEqual(pass([ticket({ state: 'review', runs: [run('r1', 'failed', 'working')] })], { previous }).posts, []);
});

test('a run first seen already ended, as after an outage, posts its start line and no end line', () => {
  const first = pass([ticket({ runs: [run('r1', 'failed')] })]);
  assert.deepEqual(texts(first), [messages.runStart.working]);
  assert.deepEqual(pass([ticket({ runs: [run('r1', 'failed')] })], { previous: first.next.records }).posts, []);
});

test('a new summary posts the first two sentences of its Outcome, without Markdown, once', () => {
  const body = '### 🎯 Outcome\n\nThe price list now updates **every night**. Old prices stay in the [history](https://x.example/h). Nothing else changed.\n\n### ✅ Success\n\nAll fine.';
  const result = pass([ticket({ comments: [summary('c1', body)] })]);
  assert.deepEqual(result.posts, [{ identifier: 'ACME-1', channel: 'C0000000001', text: 'The price list now updates every night. Old prices stay in the history.', summary: 'c1' }]);
  assert.deepEqual(pass([ticket({ comments: [summary('c1', body)] })], { previous: result.next.records }).posts, []);
});

test('summary sentences with code, ticket identifiers, AC IDs or state, recipe and type names are left out', () => {
  const body = '## Outcome\n\nI qualified ACME-12 *Price updater*. The recipe is `matt` and the type is feature.';
  assert.deepEqual(pass([ticket({ comments: [summary('c1', body)] })]).posts, []);
  const mixed = '## Outcome\n\nAC-3 passes now. Prices of <b>shops</b> & suppliers update at night.';
  assert.deepEqual(texts(pass([ticket({ comments: [summary('c1', mixed)] })])), ['Prices of &lt;b&gt;shops&lt;/b&gt; &amp; suppliers update at night.']);
});

test('a summary without an Outcome section or other comment types post nothing', () => {
  const t = ticket({ comments: [summary('c1', '### Next action\n\nApprove it.'), { id: 'c2', type: 'plan', created: '2026-11-05T11:00:00Z', body: '## Outcome\n\nPlain words.' }] });
  assert.deepEqual(pass([t]).posts, []);
});

test('a new ddev page or design link is posted once with its title; other links are only recorded', () => {
  const links = [
    { uri: 'https://acme.slack.com/archives/C0000000001', title: 'Slack channel' },
    { uri: 'https://gitlab.example/acme/-/merge_requests/7', title: 'MR' },
    { uri: 'https://gitlab.example/acme/-/pipelines/9', title: 'Pipeline' },
    { uri: 'https://acme-135.ddev.site/-/tree/feat', title: 'Branch' },
    { uri: 'https://acme-135.ddev.site/prices?a=1&b=2', title: 'Price list <new>' },
    { uri: 'https://acme-135.ddev.site/designbook/?path=/story/price', title: 'Price card design' },
  ];
  const result = pass([ticket({ links })]);
  assert.deepEqual(result.posts, [
    { identifier: 'ACME-1', channel: 'C0000000001', text: `${messages.previewLead} Price list &lt;new&gt;\nhttps://acme-135.ddev.site/prices?a=1&amp;b=2`, link: 'https://acme-135.ddev.site/prices?a=1&b=2' },
    { identifier: 'ACME-1', channel: 'C0000000001', text: `${messages.previewLead} Price card design\nhttps://acme-135.ddev.site/designbook/?path=/story/price`, link: 'https://acme-135.ddev.site/designbook/?path=/story/price' },
  ]);
  assert.deepEqual(result.next.records['ACME-1'].links, links.map((l) => l.uri));
  assert.deepEqual(pass([ticket({ links })], { previous: result.next.records }).posts, []);
});

test('a running ticket in a conversation quiet for the interval gets one heartbeat with a sentence of the newest summary since the run started', () => {
  const runs = [run('r1', 'running', 'working', NOW / 1000 - 3600)];
  const comments = [
    summary('c0', '## Outcome\n\nAn older step.', '2026-11-05T10:00:00Z'),
    summary('c1', '## Outcome\n\nThe import reads the supplier file. More to come.', '2026-11-05T11:10:00Z'),
  ];
  const previous = { 'ACME-1': { ...seen, runs: { r1: 'running' }, summaries: ['c0', 'c1'] } };
  const result = pass([ticket({ runs, comments })], { previous, quiet: INTERVAL });
  assert.deepEqual(result.posts, [{ identifier: 'ACME-1', channel: 'C0000000001', text: `${messages.stillWorking} The import reads the supplier file.`, heartbeat: true }]);
  assert.deepEqual(pass([ticket({ runs, comments })], { previous, quiet: INTERVAL - 1 }).posts, []);
});

test('the heartbeat is the bare line without a summary since the run started, also in review', () => {
  const runs = [run('r1', 'running', 'review', NOW / 1000 - 600)];
  const comments = [summary('c0', '## Outcome\n\nAn older step.', '2026-11-05T10:00:00Z')];
  const previous = { 'ACME-1': { ...seen, runs: { r1: 'running' }, summaries: ['c0'] } };
  assert.deepEqual(texts(pass([ticket({ state: 'review', runs, comments })], { previous, quiet: INTERVAL })), [messages.stillWorking]);
});

test('no heartbeat without a running run, outside working and review, or when the conversation got another post this pass', () => {
  const previous = { 'ACME-1': { ...seen, runs: { r1: 'running' } } };
  assert.deepEqual(pass([ticket({ runs: [run('r1', 'claimed')] })], { previous, quiet: INTERVAL }).posts, []);
  assert.deepEqual(pass([ticket({ state: 'plan', runs: [run('r1', 'running', 'plan')] })], { previous, quiet: INTERVAL }).posts, []);
  const ended = pass([ticket({ runs: [run('r1', 'failed'), run('r2', 'running')] })], { previous: { 'ACME-1': { ...previous['ACME-1'], lastStart: NOW } }, quiet: INTERVAL });
  assert.deepEqual(texts(ended), [messages.runPaused]);
});

test('sub-tickets sharing a conversation get one heartbeat between them, naming the one that works', () => {
  const running = (identifier) => ticket({ identifier, inherited: true, runs: [run(`${identifier}-r`, 'running')] });
  const previous = { 'ACME-2': { ...seen, runs: { 'ACME-2-r': 'running' } }, 'ACME-3': { ...seen, runs: { 'ACME-3-r': 'running' } } };
  assert.deepEqual(texts(pass([running('ACME-2'), running('ACME-3')], { previous, quiet: INTERVAL })), [`ACME-2 · ${messages.stillWorking}`]);
});

test('one pass orders a sub-ticket\'s lines run end, summary, preview, run start, each naming it', () => {
  const t = ticket({
    identifier: 'ACME-2',
    inherited: true,
    runs: [run('r2', 'running'), run('r1', 'failed')],
    comments: [summary('c1', '## Outcome\n\nPrices import now.')],
    links: [{ uri: 'https://acme-135.ddev.site/prices', title: 'Price list' }],
  });
  const result = pass([t], { previous: { 'ACME-2': { ...seen, runs: { r1: 'running' } } } });
  assert.deepEqual(texts(result), [
    `ACME-2 · ${messages.runPaused}`,
    'ACME-2 · Prices import now.',
    `ACME-2 · ${messages.previewLead} Price list\nhttps://acme-135.ddev.site/prices`,
    `ACME-2 · ${messages.runStart.working}`,
  ]);
});

test('forgetting a failed post makes the next pass choose it again, and only it', () => {
  const t = ticket({ runs: [run('r1', 'running')], comments: [summary('c1', '## Outcome\n\nPrices import now.')], links: [{ uri: 'https://acme-135.ddev.site/p', title: 'P' }] });
  const first = pass([t]);
  assert.equal(first.posts.length, 3);
  for (const p of first.posts.filter((p) => !p.link)) forget(first.next.records, p);
  assert.deepEqual(texts(pass([t], { previous: first.next.records })), ['Prices import now.', messages.runStart.working]);
  const ended = pass([ticket({ runs: [run('r1', 'failed')] })], { previous: { 'ACME-1': { ...seen, runs: { r1: 'running' } } } });
  forget(ended.next.records, ended.posts[0]);
  assert.equal(ended.next.records['ACME-1'].runs.r1, 'running');
});
