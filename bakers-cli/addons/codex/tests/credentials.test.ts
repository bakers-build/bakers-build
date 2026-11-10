import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAgent } from '../src/index.js';

/** A `codex` stub whose `login status` prints `out` to stderr and exits `code`. */
function stubCodex(out: string, code: number) {
  const bin = mkdtempSync(join(tmpdir(), 'codex-bin-'));
  writeFileSync(
    join(bin, 'codex'),
    `#!/bin/sh\necho '${out}' >&2\nexit ${code}\n`,
  );
  chmodSync(join(bin, 'codex'), 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
}

afterEach(() => vi.unstubAllEnvs());

describe('CodexAgent.credentialCheck', () => {
  const agent = () => new CodexAgent({}, mkdtempSync(join(tmpdir(), 'home-')));

  it('passes a logged-in agent', async () => {
    stubCodex('Logged in using ChatGPT', 0);
    expect(await agent().credentialCheck()).toEqual({ ok: true });
  });

  it('names the missing login', async () => {
    stubCodex('Not logged in', 1);
    expect(await agent().credentialCheck()).toEqual({
      ok: false,
      reason: 'codex: not logged in (Not logged in) — run codex login',
    });
  });
});

function reasonFor(pane: string): string | undefined {
  return new CodexAgent().authFailurePatterns.find(({ pattern }) =>
    pattern.test(pane),
  )?.reason;
}

describe('CodexAgent.authFailurePatterns', () => {
  it('names the login screen', () => {
    expect(
      reasonFor(
        'Welcome to Codex\n\n> 1. Sign in with ChatGPT\n  2. Provide your own API key',
      ),
    ).toBe(
      'codex: not logged in (stopped at its login screen) — run codex login',
    );
  });

  it('names a rejected credential', () => {
    expect(
      reasonFor(
        '■ unexpected status 401 Unauthorized: Your access token could not be refreshed',
      ),
    ).toBe('codex: credential rejected (401) — run codex login');
  });

  it('leaves a 401 in the output of a tool call alone', () => {
    expect(
      reasonFor(
        '• Ran curl -si https://gitlab.example/api/v4/user\n  └ HTTP/1.1 401 Unauthorized\n• Ran npm test\n  └ ✓ answers 401 Unauthorized without a token',
      ),
    ).toBeUndefined();
  });

  it('leaves a normal start alone', () => {
    expect(
      reasonFor('>_ OpenAI Codex\n› /bb-workflow BB-1\n• Reading the ticket'),
    ).toBeUndefined();
  });
});
