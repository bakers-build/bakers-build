import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const messages = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url), 'utf8'));

// Every key path to a text, nested ones as `states.done`.
const paths = (tree, prefix = '') =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : paths(value, `${prefix}${key}.`))).sort();

test('the poller texts exist in German and English only', () => {
  assert.deepEqual(Object.keys(messages).sort(), ['de', 'en']);
});

test('every text exists in both languages', () => {
  assert.deepEqual(paths(messages.de), paths(messages.en));
  assert.ok(paths(messages.de).includes('states.done'));
});
