import { describe, expect, it } from 'vitest';
import {
  boxProbes,
  type CommandResult,
  checkCredentials,
  parseExpiryFile,
} from '../../src/core/credentials.js';

const NOW = new Date('2026-11-10T12:00:00Z');

describe('credential evaluator', () => {
  it('warns from 14 days before a recorded expiry and errors once it lapsed', async () => {
    const recorded = parseExpiryFile(
      [
        '# recorded by the operator',
        'claude: 2026-11-25',
        'codex: 2026-11-24',
        'pm-bot-registry-token: 2026-11-10',
        "pm-bot-bakers-api-key: '2026-11-09'",
        'keytec-vault-token: next year',
      ].join('\n'),
    );
    expect(await checkCredentials({ recorded, probes: [], now: NOW })).toEqual([
      {
        name: 'claude',
        status: 'ok',
        expires_at: '2026-11-25',
        reason: 'expires on 2026-11-25',
      },
      {
        name: 'codex',
        status: 'warning',
        expires_at: '2026-11-24',
        reason: 'expires on 2026-11-24, in 14 days',
      },
      {
        name: 'pm-bot-registry-token',
        status: 'warning',
        expires_at: '2026-11-10',
        reason: 'expires on 2026-11-10, today',
      },
      {
        name: 'pm-bot-bakers-api-key',
        status: 'error',
        expires_at: '2026-11-09',
        reason: 'expired on 2026-11-09',
      },
      {
        name: 'keytec-vault-token',
        status: 'error',
        reason:
          'unreadable expiry date "next year" in ~/.bakers/credential-expiry.yml',
      },
    ]);
  });

  it('reports a rejected or failing probe as an error, a read date over a recorded one, a recorded date for an accepted probe', async () => {
    const result = await checkCredentials({
      recorded: { github: '2027-01-01', claude: '2026-11-12' },
      now: NOW,
      probes: [
        { name: 'github', check: async () => ({ expires_at: '2026-11-20' }) },
        {
          name: 'gitlab',
          check: async () => ({ rejected: 'GitLab rejected the token (401)' }),
        },
        { name: 'claude', check: async () => ({}) },
        {
          name: 'vault',
          check: async () => {
            throw new Error('vault: connection refused');
          },
        },
        { name: 'slack', check: async () => undefined },
      ],
    });
    expect(result).toEqual([
      {
        name: 'github',
        status: 'warning',
        expires_at: '2026-11-20',
        reason: 'expires on 2026-11-20, in 10 days',
      },
      {
        name: 'gitlab',
        status: 'error',
        reason: 'GitLab rejected the token (401)',
      },
      {
        name: 'claude',
        status: 'warning',
        expires_at: '2026-11-12',
        reason: 'expires on 2026-11-12, in 2 days',
      },
      {
        name: 'vault',
        status: 'error',
        reason: 'check failed: vault: connection refused',
      },
    ]);
  });

  it('reads an empty or missing file as no recorded dates', () => {
    expect(parseExpiryFile('')).toEqual({});
  });
});

/** A command runner answering by the command name. */
function runner(answers: Record<string, CommandResult>) {
  return async (cmd: string) =>
    answers[cmd] ?? {
      ok: false,
      stdout: '',
      stderr: `${cmd}: not found`,
      missing: true,
    };
}

async function probe(
  name: string,
  answers: Record<string, CommandResult>,
  env = {},
) {
  const p = boxProbes(runner(answers), env).find((x) => x.name === name);
  return p?.check();
}

describe('box probes', () => {
  it('reads the GitHub token expiry from the API header', async () => {
    expect(
      await probe('github', {
        gh: {
          ok: true,
          stdout:
            'HTTP/2.0 200 OK\nGithub-Authentication-Token-Expiration: 2026-12-01 10:00:00 UTC\n\n{}',
          stderr: '',
        },
      }),
    ).toEqual({ expires_at: '2026-12-01' });
  });

  it('passes a GitHub token without expiry, rejects a 401 and skips a box without gh', async () => {
    expect(
      await probe('github', {
        gh: { ok: true, stdout: 'HTTP/2.0 200 OK\n\n{}', stderr: '' },
      }),
    ).toEqual({});
    expect(
      await probe('github', {
        gh: {
          ok: false,
          stdout: '',
          stderr: 'HTTP 401: Bad credentials (https://api.github.com/)',
        },
      }),
    ).toEqual({
      rejected:
        'GitHub rejected the token: HTTP 401: Bad credentials (https://api.github.com/) — renew it and run gh auth login',
    });
    expect(await probe('github', {})).toBeUndefined();
    expect(
      await probe('github', {
        gh: {
          ok: false,
          stdout: '',
          stderr: 'To get started with GitHub CLI, please run:  gh auth login',
        },
      }),
    ).toBeUndefined();
  });

  it('reads the GitLab token expiry', async () => {
    expect(
      await probe('gitlab', {
        glab: {
          ok: true,
          stdout: '{"name":"agents","expires_at":"2027-01-15"}',
          stderr: '',
        },
      }),
    ).toEqual({ expires_at: '2027-01-15' });
    expect(
      await probe('gitlab', {
        glab: { ok: false, stdout: '', stderr: 'glab: 401 Unauthorized' },
      }),
    ).toEqual({
      rejected:
        'GitLab rejected the token: glab: 401 Unauthorized — renew it and run glab auth login',
    });
  });

  it('reads the Vault token expiry only where Vault is configured', async () => {
    const vault = {
      ok: true,
      stdout: '{"data":{"expire_time":"2027-03-01T08:00:00.1Z"}}',
      stderr: '',
    };
    expect(await probe('vault', { vault })).toBeUndefined();
    expect(
      await probe(
        'vault',
        { vault },
        { VAULT_ADDR: 'https://vault', VAULT_TOKEN: 't' },
      ),
    ).toEqual({ expires_at: '2027-03-01' });
    expect(
      await probe(
        'vault',
        {
          vault: {
            ok: false,
            stdout: '',
            stderr: 'Code: 403. Errors: permission denied',
          },
        },
        { VAULT_ADDR: 'https://vault', VAULT_TOKEN: 't' },
      ),
    ).toEqual({
      rejected:
        'Vault rejected the token: Code: 403. Errors: permission denied — renew VAULT_TOKEN',
    });
  });
});
