import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAgent } from '../src/index.js';

/** A `claude` stub whose `auth status --json` prints `json` and exits `code`. */
function stubClaude(json: string, code: number) {
  const bin = mkdtempSync(join(tmpdir(), 'claude-bin-'));
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\necho '${json}'\nexit ${code}\n`,
  );
  chmodSync(join(bin, 'claude'), 0o755);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
}

afterEach(() => vi.unstubAllEnvs());

describe('ClaudeAgent.credentialCheck', () => {
  const agent = () => new ClaudeAgent({}, mkdtempSync(join(tmpdir(), 'home-')));

  it('passes a logged-in agent', async () => {
    stubClaude('{"loggedIn": true, "loginExpiresAt": null}', 0);
    expect(await agent().credentialCheck()).toEqual({ ok: true });
  });

  it('names the missing login', async () => {
    stubClaude('{"loggedIn": false, "authMethod": "none"}', 1);
    expect(await agent().credentialCheck()).toEqual({
      ok: false,
      reason:
        'claude: not logged in — run claude /login, or set CLAUDE_CODE_OAUTH_TOKEN from claude setup-token',
    });
  });

  it('names a lapsed login', async () => {
    stubClaude(
      '{"loggedIn": true, "loginExpiresAt": "2020-01-01T00:00:00Z"}',
      0,
    );
    expect(await agent().credentialCheck()).toEqual({
      ok: false,
      reason: 'claude: login expired on 2020-01-01 — run claude /login',
    });
  });

  it('passes when the CLI cannot report its status, leaving it to the launch watch', async () => {
    stubClaude('error: unknown command auth', 2);
    expect(await agent().credentialCheck()).toEqual({ ok: true });
  });
});

/** The first matching pattern's reason for `pane`, as the launch watch picks it. */
function reasonFor(pane: string): string | undefined {
  return new ClaudeAgent().authFailurePatterns.find(({ pattern }) =>
    pattern.test(pane),
  )?.reason;
}

describe('ClaudeAgent.authFailurePatterns', () => {
  it('names the login screen', () => {
    expect(
      reasonFor(
        'Select login method:\n\n ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise\n   2. Anthropic Console account · API usage billing',
      ),
    ).toBe(
      'claude: not logged in (stopped at its login screen) — run claude /login',
    );
  });

  it('names the first-run screen', () => {
    expect(
      reasonFor(
        "Welcome to Claude Code\n\nLet's get started.\n\nChoose the text style that looks best with your terminal",
      ),
    ).toBe(
      'claude: not logged in (stopped at its first-run screen) — run claude /login',
    );
  });

  it('names an expired or revoked credential', () => {
    expect(
      reasonFor(
        '⎿  API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please obtain a new token or refresh your existing token."}} · Please run /login',
      ),
    ).toBe('claude: credential rejected (API 401) — run claude /login');
    expect(reasonFor('Invalid API key · Please run /login')).toBe(
      'claude: credential rejected (API 401) — run claude /login',
    );
  });

  it('leaves a normal start alone, even when the ticket talks about logins', () => {
    expect(
      reasonFor(
        '✻ Welcome to Claude Code!\n> /bb-workflow BB-1\n⏺ Reading the ticket: "the agent is not logged in; run claude /login"',
      ),
    ).toBeUndefined();
  });
});
