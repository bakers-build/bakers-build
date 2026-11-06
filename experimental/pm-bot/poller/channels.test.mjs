import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { channelSteps, slug, ticketChannelName } from './channels.mjs';

// The examples the plugin's slug tests share (plugins/bot-channels/test_channels.py).
const examples = JSON.parse(readFileSync(new URL('../plugins/bot-channels/slug-examples.json', import.meta.url), 'utf8'));

test('the slug matches every shared example', () => {
  for (const [text, expected] of examples) assert.equal(slug(text), expected, text);
});

test('a ticket channel is the lower-case identifier and a slug of the title', () => {
  assert.equal(ticketChannelName('YF-12', 'Comic Sans'), 'yf-12-comic-sans');
});

test('a long title is cut at a word boundary to 40 characters, suffix included', () => {
  const title = 'Show the opening hours of every studio on the start page';
  assert.equal(ticketChannelName('YF-12', title), 'yf-12-show-the-opening-hours-of-every');
  assert.equal(ticketChannelName('YF-12', title, 2), 'yf-12-show-the-opening-hours-of-every-2');
  assert.ok(ticketChannelName('YF-12', title, 12).length <= 40);
});

test('a title with no letters or digits gives the identifier alone', () => {
  assert.equal(ticketChannelName('YF-12', '!!! ???'), 'yf-12');
});

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-11-20T12:00:00Z');
const ticket = (identifier, state, channel, extra = {}) => ({ identifier, title: 'Comic Sans', state, conversation: channel && { channel }, ...extra });
const bot = { C1: { name: 'req-comic-sans', requester: 'U1', created: '2026-11-19T10:00:00Z' } };
const kinds = (steps) => steps.map((s) => [s.kind, s.channel]);

test('a linked request channel is owed a rename, once', () => {
  assert.deepEqual(kinds(channelSteps({ tickets: {}, channels: {} }, [ticket('YF-12', 'plan', 'C1')], bot, now)), [['rename', 'C1']]);
  assert.deepEqual(kinds(channelSteps({ tickets: {}, channels: { C1: { ticket: 'YF-12', renamed: true } } }, [ticket('YF-12', 'plan', 'C1')], bot, now)), []);
});

test('a channel the bot did not create is left alone', () => {
  assert.deepEqual(channelSteps({ tickets: { 'YF-12': 'done' }, channels: {} }, [ticket('YF-12', 'done', 'C7')], bot, now), []);
});

test('a ticket whose final state was posted is owed the archive, at done and at cancelled', () => {
  const channels = { C1: { ticket: 'YF-12', renamed: true } };
  for (const state of ['done', 'cancelled']) {
    assert.deepEqual(kinds(channelSteps({ tickets: { 'YF-12': state }, channels }, [ticket('YF-12', state, 'C1')], bot, now)), [['archive', 'C1']]);
  }
  // Not yet posted: the poller still holds the previous state.
  assert.deepEqual(channelSteps({ tickets: { 'YF-12': 'review' }, channels }, [ticket('YF-12', 'done', 'C1')], bot, now), []);
});

test('a ticket that leaves done or cancelled with an archived channel is owed a reopen', () => {
  const channels = { C1: { ticket: 'YF-12', renamed: true, archived: true } };
  assert.deepEqual(kinds(channelSteps({ tickets: { 'YF-12': 'done' }, channels }, [ticket('YF-12', 'working', 'C1')], bot, now)), [['reopen', 'C1']]);
  assert.deepEqual(channelSteps({ tickets: { 'YF-12': 'done' }, channels }, [ticket('YF-12', 'done', 'C1')], bot, now), []);
});

test('a sub-ticket in its ancestor\'s channel and a ticket in a thread are owed nothing', () => {
  const tickets = [ticket('YF-13', 'done', 'C1', { inherited: true }), { identifier: 'YF-14', state: 'done', conversation: { channel: 'C1', thread_ts: '1.2' } }];
  assert.deepEqual(kinds(channelSteps({ tickets: { 'YF-13': 'done', 'YF-14': 'done' }, channels: {} }, tickets, bot, now)), []);
});

test('a request channel without a ticket is owed the abandon after 7 days, not after 6', () => {
  const created = (days) => ({ C1: { ...bot.C1, created: new Date(now - days * DAY).toISOString() } });
  assert.deepEqual(kinds(channelSteps({ tickets: {}, channels: {} }, [], created(7), now)), [['abandon', 'C1']]);
  assert.deepEqual(channelSteps({ tickets: {}, channels: {} }, [], created(6), now), []);
  // A message seen 6 days ago keeps it open; an archived one is done.
  assert.deepEqual(channelSteps({ tickets: {}, channels: { C1: { seen: now - 6 * DAY } } }, [], created(30), now), []);
  assert.deepEqual(channelSteps({ tickets: {}, channels: { C1: { archived: true } } }, [], created(30), now), []);
});
