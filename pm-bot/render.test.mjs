import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from './render.mjs';

test('each placeholder takes its value from the environment', () => {
  const env = { SLACK_ALLOWED_CHANNELS: 'C01,C02', PM_BOT_CLONE_DIR: '/opt/clone' };
  assert.equal(
    render('allowed_channels: ${SLACK_ALLOWED_CHANNELS}\nroot: ${PM_BOT_CLONE_DIR}\n', env),
    'allowed_channels: C01,C02\nroot: /opt/clone\n',
  );
});

test('a URL, an email-like value and a model name pass unchanged', () => {
  const env = { A: 'https://bakers.example.com/', B: 'bot@example.com', C: 'claude-sonnet-5-5' };
  assert.equal(render('${A} ${B} ${C}', env), 'https://bakers.example.com/ bot@example.com claude-sonnet-5-5');
});

test('an unset or empty value stops the render and names the key', () => {
  assert.throws(() => render('x: ${PM_BOT_MODEL}', {}), /PM_BOT_MODEL is not set/);
  assert.throws(() => render('x: ${PM_BOT_MODEL}', { PM_BOT_MODEL: '' }), /PM_BOT_MODEL is not set/);
});

test('a value that could change the YAML structure stops the render', () => {
  for (const unsafe of ['a b', 'a"b', "a'b", 'a\nb: c', 'a #b', '{a}', '[a]', '-a', '*a', '&a', '!a']) {
    assert.throws(() => render('x: ${V}', { V: unsafe }), /V may hold only/, JSON.stringify(unsafe));
  }
});

test('the rendered text keeps no placeholder', () => {
  const out = render('a: ${A}\nb: "$HOME"\n', { A: 'one' });
  assert.equal(out, 'a: one\nb: "$HOME"\n');
  assert.doesNotMatch(out, /\$\{/);
});
