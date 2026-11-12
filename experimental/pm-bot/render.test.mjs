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

test('a ${env:…} reference is left for Hermes, so the key it names never reaches the output', () => {
  const env = { BAKERS_URL: 'https://bakers.example.com', BAKERS_API_KEY: 'bb-secret' };
  const out = render('url: ${BAKERS_URL}/mcp\nAuthorization: "Bearer ${env:BAKERS_API_KEY}"\n', env);
  assert.equal(out, 'url: https://bakers.example.com/mcp\nAuthorization: "Bearer ${env:BAKERS_API_KEY}"\n');
  assert.doesNotMatch(out, /bb-secret/);
});

test('SOUL.template.md renders from the fixture env with no placeholder left', async () => {
  const { readFileSync } = await import('node:fs');
  const env = Object.fromEntries(
    readFileSync(new URL('./test/fixture.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  // The entrypoint turns an empty PM_BOT_CONDUCTOR into the word the template shows.
  env.PM_BOT_CONDUCTOR_TEXT = env.PM_BOT_CONDUCTOR || 'none';
  const out = render(readFileSync(new URL('./SOUL.template.md', import.meta.url), 'utf8'), env);
  assert.doesNotMatch(out, /\$\{/);
  assert.match(out, new RegExp(env.PM_BOT_PROJECT));
  assert.match(out, /`none`/);
  assert.doesNotMatch(out, new RegExp(env.BAKERS_API_KEY));
  // Every PM bot replies with the ticket link the server returned.
  assert.match(out, /\[<identifier> · <title>\]\(<url>\).*`url`.*`bakers_ticket_create`/);
});
