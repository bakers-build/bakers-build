import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** One box credential as the conductor reports it on its heartbeat. */
export interface CredentialHealth {
  name: string;
  status: 'ok' | 'warning' | 'error';
  /** `YYYY-MM-DD`, when the expiry is known. */
  expires_at?: string;
  reason: string;
}

/**
 * What a probe learned from the credential's issuer: its expiry date, or why
 * the issuer rejected it (a full sentence, shown as written). `undefined`
 * means the credential is not used here.
 */
export type ProbeResult =
  | { expires_at?: string; rejected?: string }
  | undefined;

export interface CredentialProbe {
  name: string;
  check(): Promise<ProbeResult>;
}

/** Days before an expiry from which a credential is a warning. */
export const WARN_DAYS = 14;

export const EXPIRY_FILE = '~/.bakers/credential-expiry.yml';

/** `name: YYYY-MM-DD` lines; comments, blanks and quotes are tolerated. */
export function parseExpiryFile(text: string): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([^#:\s][^:]*?)\s*:\s*['"]?(.*?)['"]?\s*$/.exec(line);
    if (m?.[1] && m[2]) recorded[m[1]] = m[2];
  }
  return recorded;
}

export async function readExpiryFile(
  file = join(homedir(), '.bakers', 'credential-expiry.yml'),
): Promise<Record<string, string>> {
  try {
    return parseExpiryFile(await readFile(file, 'utf8'));
  } catch {
    return {}; // no file: nothing recorded
  }
}

function byExpiry(
  name: string,
  date: string,
  now: Date,
  source: string,
): CredentialHealth {
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00Z`)
    : Number.NaN;
  if (Number.isNaN(expiry)) {
    return {
      name,
      status: 'error',
      reason: `unreadable expiry date "${date}" in ${source}`,
    };
  }
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Math.round((expiry - today) / 86_400_000);
  if (days < 0) {
    return {
      name,
      status: 'error',
      expires_at: date,
      reason: `expired on ${date}`,
    };
  }
  if (days > WARN_DAYS) {
    return {
      name,
      status: 'ok',
      expires_at: date,
      reason: `expires on ${date}`,
    };
  }
  return {
    name,
    status: 'warning',
    expires_at: date,
    reason: `expires on ${date}, ${days === 0 ? 'today' : `in ${days} days`}`,
  };
}

/**
 * Evaluate the box's credentials: every probe, then every recorded date a
 * probe did not already cover. A probe that throws is an error, never a crash.
 */
export async function checkCredentials(inputs: {
  recorded: Record<string, string>;
  probes: readonly CredentialProbe[];
  now: Date;
}): Promise<CredentialHealth[]> {
  const out: CredentialHealth[] = [];
  const seen = new Set<string>();
  for (const probe of inputs.probes) {
    let result: ProbeResult;
    try {
      result = await probe.check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({
        name: probe.name,
        status: 'error',
        reason: `check failed: ${message}`,
      });
      seen.add(probe.name);
      continue;
    }
    if (!result) continue;
    seen.add(probe.name);
    const recorded = inputs.recorded[probe.name];
    if (result.rejected) {
      out.push({ name: probe.name, status: 'error', reason: result.rejected });
    } else if (result.expires_at) {
      out.push(byExpiry(probe.name, result.expires_at, inputs.now, probe.name));
    } else if (recorded) {
      out.push(byExpiry(probe.name, recorded, inputs.now, EXPIRY_FILE));
    } else {
      out.push({ name: probe.name, status: 'ok', reason: 'accepted' });
    }
  }
  for (const [name, date] of Object.entries(inputs.recorded)) {
    if (!seen.has(name))
      out.push(byExpiry(name, date, inputs.now, EXPIRY_FILE));
  }
  return out;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The command is not installed. */
  missing?: boolean;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<CommandResult>;

export const runCommand: CommandRunner = async (cmd, args) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(cmd, args, {
      timeout: 30_000,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      code?: unknown;
      message: string;
    };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr || e.message,
      ...(e.code === 'ENOENT' ? { missing: true } : {}),
    };
  }
};

const REJECTED =
  /\b(401|403)\b|unauthori[sz]ed|bad credentials|permission denied|token.{0,20}(expired|revoked|invalid)/i;

/** A failed issuer call: rejected when it says so, otherwise not checkable here. */
function failure(
  result: CommandResult,
  issuer: string,
  fix: string,
): ProbeResult {
  if (result.missing || !REJECTED.test(result.stderr)) return undefined;
  return {
    rejected: `${issuer} rejected the token: ${result.stderr.trim()} — ${fix}`,
  };
}

/**
 * The issuers that tell a token's expiry: GitHub and GitLab through their
 * CLIs' logins, Vault where the box has it configured. A CLI that is missing
 * or not logged in means the credential is not used here.
 */
export function boxProbes(
  run: CommandRunner = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): CredentialProbe[] {
  return [
    {
      name: 'github',
      async check() {
        const r = await run('gh', ['api', '-i', '/']);
        if (!r.ok)
          return failure(r, 'GitHub', 'renew it and run gh auth login');
        const m =
          /^github-authentication-token-expiration:\s*(\d{4}-\d{2}-\d{2})/im.exec(
            r.stdout,
          );
        return m ? { expires_at: m[1] as string } : {};
      },
    },
    {
      name: 'gitlab',
      async check() {
        const r = await run('glab', ['api', 'personal_access_tokens/self']);
        if (!r.ok)
          return failure(r, 'GitLab', 'renew it and run glab auth login');
        const expires = (JSON.parse(r.stdout) as { expires_at?: unknown })
          .expires_at;
        return typeof expires === 'string'
          ? { expires_at: expires.slice(0, 10) }
          : {};
      },
    },
    {
      name: 'vault',
      async check() {
        if (!env.VAULT_ADDR || !env.VAULT_TOKEN) return undefined;
        const r = await run('vault', ['token', 'lookup', '-format=json']);
        if (!r.ok) return failure(r, 'Vault', 'renew VAULT_TOKEN');
        const expires = (
          JSON.parse(r.stdout) as { data?: { expire_time?: unknown } }
        ).data?.expire_time;
        return typeof expires === 'string'
          ? { expires_at: expires.slice(0, 10) }
          : {};
      },
    },
  ];
}
