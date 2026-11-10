import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { servicesToShare } from '../src/claim-share.js';
import type { ClaimedDiscovery, ClaimedService } from '../src/claims.js';
import { PORTS_NEEDS_ENTRY } from '../src/config.js';
import {
  isLegacyKillCandidate,
  liveTunnel,
  quickTunnelNotice,
  registerPorts,
  resolveTicketIdentifier,
  revalidatesForKill,
  selectService,
  shouldKeepTunnelRecord,
  staleKeys,
} from '../src/index.js';
import { commands } from '../src/preset.js';
import type { TunnelDesiredRecord } from '../src/tunnel-state.js';

function service(
  overrides: Partial<ClaimedService> & { key: string },
): ClaimedService {
  return {
    claim: 'container',
    status: 'healthy',
    local: `https://${overrides.key}.site.test`,
    rawPorts: [],
    rules: [{ key: overrides.key, service: 'https://127.0.0.1:443' }],
    ...overrides,
  };
}

describe('the ports command surface', () => {
  it('declares itself for `bakers --help` without loading the plugin', () => {
    const declared = commands([], undefined as never);
    expect(declared).toContainEqual(
      expect.objectContaining({
        name: 'ports',
        plugin: '@bakers-build/addon-ports',
      }),
    );
  });

  it('mounts the five subcommands on a program', () => {
    const program = new Command();
    registerPorts(program, () => '/wt');
    const ports = program.commands.find((c) => c.name() === 'ports');
    const subs = ports?.commands.map((c) => c.name()).sort();
    expect(subs).toEqual(['down', 'list', 'reap', 'status', 'up']);
  });

  it('declares an optional service key and --ticket on up, never --host or the removed --url/numeric port (spec v5)', () => {
    const program = new Command();
    registerPorts(program, () => '/wt');
    const up = program.commands
      .find((c) => c.name() === 'ports')
      ?.commands.find((c) => c.name() === 'up');
    const long = up?.options.map((o) => o.long);
    expect(long).not.toContain('--host');
    expect(long).toContain('--ticket');
    expect(long).not.toContain('--url');
    expect(up?.registeredArguments[0]?.name()).toBe('service');
    expect(up?.registeredArguments[0]?.required).toBe(false);
  });

  it('declares down with an optional key, not a required numeric port', () => {
    const program = new Command();
    registerPorts(program, () => '/wt');
    const down = program.commands
      .find((c) => c.name() === 'ports')
      ?.commands.find((c) => c.name() === 'down');
    expect(down?.registeredArguments[0]?.required).toBe(false);
  });
});

describe('resolveTicketIdentifier', () => {
  it('prefers an explicit --ticket over the branch', () => {
    expect(resolveTicketIdentifier('BB-676', 'feat/other-1')).toEqual({
      ok: true,
      identifier: 'BB-676',
    });
  });

  it('infers the unique ticket token from the branch', () => {
    expect(
      resolveTicketIdentifier(undefined, 'feat/bb-676-bakers-ports-addon'),
    ).toEqual({
      ok: true,
      identifier: 'BB-676',
    });
  });

  it('fails when the branch carries no ticket token', () => {
    const result = resolveTicketIdentifier(undefined, 'develop');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no ticket token/i);
  });

  it('fails on an ambiguous branch rather than guessing', () => {
    const result = resolveTicketIdentifier(undefined, 'merge-bb-1-into-bb-2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/ambiguous/i);
  });

  it('fails when there is no branch and no explicit ticket', () => {
    const result = resolveTicketIdentifier(undefined, null);
    expect(result.ok).toBe(false);
  });
});

describe('selectService', () => {
  const drupalAdmin = service({
    key: 'drupal-admin',
    rawPorts: [{ virtualHost: 'admin.pynq.pynq-42.site.test' } as never],
  });
  const drupalMembers = service({
    key: 'drupal-members',
    rawPorts: [{ virtualHost: 'members.pynq.pynq-42.site.test' } as never],
  });
  const mailpit = service({ key: 'mailpit' });
  const discovery: ClaimedDiscovery = {
    services: [drupalAdmin, drupalMembers, mailpit],
  };

  it('selects an unambiguous service by key', () => {
    expect(selectService(discovery, 'mailpit')).toEqual({
      ok: true,
      service: mailpit,
    });
  });

  it('selects a multisite claim by its full, already-disambiguating key (spec v5: no --host)', () => {
    expect(selectService(discovery, 'drupal-admin')).toEqual({
      ok: true,
      service: drupalAdmin,
    });
    expect(selectService(discovery, 'drupal-members')).toEqual({
      ok: true,
      service: drupalMembers,
    });
  });

  it('refuses an ambiguous base name, pointing at the full key instead of --host', () => {
    const result = selectService(discovery, 'drupal');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/ambiguous/i);
      expect(result.message).toMatch(/full key/i);
    }
  });

  it('reports an actionable error for an unknown/numeric service, the removed `up <port>` path', () => {
    const result = selectService(discovery, '5173');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no claimed service/i);
      expect(result.message).toContain('mailpit');
    }
  });
});

describe('shouldKeepTunnelRecord (R4)', () => {
  const storybook = service({
    key: 'storybook',
    rawPorts: [
      {
        worktree: '/work',
        hostPort: 6006,
        listening: true,
        exposed: true,
      },
    ],
  });
  const drupal = service({
    key: 'drupal-admin',
    rawPorts: [
      {
        worktree: '/work',
        containerId: 'web123',
        listening: true,
        exposed: true,
      },
    ],
  });

  it('reaps a host-backed record when discovery is fully healthy and the claim is gone', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'storybook')).toBe(false);
  });

  it('keeps a host-backed record (Storybook) when its own host probe failed, with the claim still present', () => {
    // Realistic: Storybook is still matched by `cmdline` (no probe needed for
    // that evidence), but the SAME discovery pass also carries a host-source
    // diagnostic (a different/unrelated host probe step failed) — the claim
    // depends on host evidence, so the record must be kept, not reaped on
    // the strength of a probe gap it cannot rule itself out against.
    const discovery: ClaimedDiscovery = {
      services: [storybook],
      diagnostics: [{ source: 'host', message: '`ss -ltnpH` failed' }],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'storybook')).toBe(true);
  });

  it('C: a host-backed record with NO claim at all is kept when the whole host probe failed — a whole-pass `ss -ltnpH` failure blinds every host-backed no-claim record at once, same as a claimed one', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [
        { source: 'host', message: '`ss -ltnpH` failed', wholePass: true },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'storybook')).toBe(true);
  });

  it('a host-backed record with NO claim at all is reaped on an unrelated per-listener host diagnostic — that is not a whole-pass failure', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [
        { source: 'host', message: 'listening port 9999 has no visible owner' },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'storybook')).toBe(false);
  });

  it('a live container-backed claim is kept, unaffected by an unrelated host diagnostic (N3)', () => {
    const discovery: ClaimedDiscovery = {
      services: [drupal],
      diagnostics: [{ source: 'host', message: 'pid vanished' }],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'drupal-admin')).toBe(true);
  });

  it('a VANISHED container-backed claim is reaped despite an unrelated host diagnostic (N3)', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [{ source: 'host', message: 'pid vanished' }],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'drupal-admin')).toBe(false);
  });

  it('blocks a container-backed record on a docker-source diagnostic', () => {
    const discovery: ClaimedDiscovery = {
      services: [drupal],
      diagnostics: [{ source: 'docker', message: '`docker inspect` failed' }],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'drupal-admin')).toBe(true);
  });

  it("D: a live container-backed claim is unaffected by an UNRELATED container's diagnostic in the same worktree (reaps if actually gone, stays if actually healthy)", () => {
    // Realistic multi-container worktree (web + db, as pynq-43's does):
    // `mailpit` resolves fine on the `web` container; the `db` container's
    // supervisor probe failed. Before origin-tagging, ANY diagnostic
    // anywhere in the worktree blocked every container-backed record's
    // `blocked` check — this must no longer be true for mailpit's own claim.
    const mailpit = service({
      key: 'mailpit',
      rawPorts: [
        {
          worktree: '/work',
          containerId: 'web123',
          listening: true,
          exposed: true,
        },
      ],
    });
    const discovery: ClaimedDiscovery = {
      services: [mailpit],
      diagnostics: [
        {
          source: 'supervisor',
          message: 'supervisorctl status failed for db456',
          containerId: 'db456',
        },
      ],
      unclaimed: [],
    };
    // Still claimed/healthy, no diagnostic blocks ITS origin: kept (not reaped).
    expect(shouldKeepTunnelRecord(discovery, 'mailpit')).toBe(true);
  });

  it("B: a no-claim record is KEPT on an unrelated container's per-container diagnostic — a vanished claim stores no containerId to origin-scope against, so it cannot tell this unrelated gap from its own (the tradeoff finding B's reap regression required)", () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [
        {
          source: 'supervisor',
          message: 'supervisorctl status failed for phpmyadmin1',
          containerId: 'phpmyadmin1',
        },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'vite')).toBe(true);
  });

  it("D: preserves a record whose OWN container's evidence is unresolved, even alongside an unrelated container diagnostic", () => {
    const mailpit = service({
      key: 'mailpit',
      rawPorts: [
        {
          worktree: '/work',
          containerId: 'web123',
          listening: true,
          exposed: true,
        },
      ],
    });
    const discovery: ClaimedDiscovery = {
      services: [mailpit],
      diagnostics: [
        {
          source: 'supervisor',
          message: 'supervisorctl status failed for web123',
          containerId: 'web123',
        },
        {
          source: 'web-sockets',
          message: 'in-container socket probe failed for db456',
          containerId: 'db456',
        },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'mailpit')).toBe(true);
  });

  it('with no claim at all, reaps only when no container-backed diagnostic blocks it', () => {
    const noDiag: ClaimedDiscovery = {
      services: [],
      diagnostics: [],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(noDiag, 'gone')).toBe(false);
    const dockerDiag: ClaimedDiscovery = {
      services: [],
      diagnostics: [{ source: 'docker', message: 'denied' }],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(dockerDiag, 'gone')).toBe(true);
  });

  // BB-681 review N1: a claimer diagnostic scoped by `keyPrefix` protects
  // only `web`/`web-<host>` records, not every vanished record in the
  // worktree — another service (e.g. Storybook) going away in the same pass
  // is unrelated and must still reap.
  it('a vanished record outside the prefix (storybook) reaps despite a prefix-scoped claimer diagnostic in the same pass (N1)', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [
        { source: 'claimer', keyPrefix: 'web', message: 'hosts unreadable' },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'storybook')).toBe(false);
  });

  it('a vanished web-<host> alias record is kept on a web-scoped claimer diagnostic (I1)', () => {
    const discovery: ClaimedDiscovery = {
      services: [],
      diagnostics: [
        { source: 'claimer', keyPrefix: 'web', message: 'hosts unreadable' },
      ],
      unclaimed: [],
    };
    expect(shouldKeepTunnelRecord(discovery, 'web')).toBe(true);
    expect(shouldKeepTunnelRecord(discovery, 'web-admin-site-test')).toBe(true);
  });
});

describe('staleKeys', () => {
  const service = 'https://127.0.0.1:443';
  const stored: TunnelDesiredRecord = {
    worktree: '/work',
    ticket: 'pynq-42',
    key: 'web',
    service,
    direct: 'http://172.18.0.19:80',
    desired: 'present',
    applied: 'applied',
  };
  const discoveryWith = (direct: string): ClaimedDiscovery => ({
    services: [
      {
        key: 'web',
        claim: 'container',
        status: 'healthy',
        local: 'https://pynq-42.site.test',
        rawPorts: [],
        rules: [{ key: 'web', service, direct }],
      },
    ],
    diagnostics: [],
    unclaimed: [],
  });

  it('flags a record whose claimed container IP changed', () => {
    expect(staleKeys([stored], discoveryWith('http://172.18.0.23:80'))).toEqual(
      new Set(['web']),
    );
  });

  it('flags nothing when the origin is unchanged', () => {
    expect(staleKeys([stored], discoveryWith('http://172.18.0.19:80'))).toEqual(
      new Set(),
    );
  });

  it('leaves a record without a claim to reap', () => {
    expect(
      staleKeys([stored], { services: [], diagnostics: [], unclaimed: [] }),
    ).toEqual(new Set());
  });
});

describe('liveTunnel', () => {
  const service = 'https://127.0.0.1:443';
  const stored: TunnelDesiredRecord = {
    worktree: '/work',
    ticket: 'pynq-42',
    key: 'web',
    service,
    direct: 'http://172.18.0.19:80',
    desired: 'present',
    applied: 'applied',
  };
  const web = (overrides: Partial<ClaimedService>): ClaimedDiscovery => ({
    services: [
      {
        key: 'web',
        claim: 'container',
        status: 'healthy',
        local: 'https://pynq-42.site.test',
        rawPorts: [
          {
            worktree: '/work',
            containerId: 'web123',
            listening: true,
            exposed: true,
          },
        ],
        rules: [{ key: 'web', service, direct: 'http://172.18.0.23:80' }],
        ...overrides,
      },
    ],
    diagnostics: [],
    unclaimed: [],
  });

  it('hands back the fresh rule when the container IP changed', () => {
    expect(liveTunnel(stored, web({}))).toEqual({
      live: true,
      rule: { key: 'web', service, direct: 'http://172.18.0.23:80' },
    });
  });

  it('a stopped container is not live, so its route is taken down', () => {
    expect(liveTunnel(stored, web({ status: 'stopped', rules: [] }))).toEqual({
      live: false,
    });
  });

  it('keeps a record without a rule while its own container probe failed', () => {
    const discovery: ClaimedDiscovery = {
      ...web({ status: 'unknown', rules: [] }),
      diagnostics: [
        { source: 'docker', message: 'boom', containerId: 'web123' },
      ],
    };
    expect(liveTunnel(stored, discovery)).toEqual({ live: true });
  });
});

describe('servicesToShare (spec v5: `up` with no key)', () => {
  it('selects every eligible service', () => {
    const drupal = service({ key: 'drupal-admin' });
    const mailpit = service({ key: 'mailpit' });
    const dead = service({ key: 'vite', rules: [] });
    const discovery: ClaimedDiscovery = {
      services: [drupal, mailpit, dead],
    };
    expect(
      servicesToShare(discovery)
        .map((s) => s.key)
        .sort(),
    ).toEqual(['drupal-admin', 'mailpit']);
  });

  it('still shares a service already applied to the discovered rule (BB-681 review C4: no fast path)', () => {
    const drupal = service({ key: 'drupal-admin' });
    const mailpit = service({ key: 'mailpit' });
    const discovery: ClaimedDiscovery = {
      services: [drupal, mailpit],
    };
    expect(
      servicesToShare(discovery)
        .map((s) => s.key)
        .sort(),
    ).toEqual(['drupal-admin', 'mailpit']);
  });

  it('F: picks a service back up for sharing when its applied record is stale (e.g. after a notional container restart rebound the target)', () => {
    const mailpit = service({
      key: 'mailpit',
      rules: [{ key: 'mailpit', service: 'https://127.0.0.1:8027' }],
    });
    const discovery: ClaimedDiscovery = { services: [mailpit] };
    // Persisted record still targets the OLD bound port (8026) — but
    // BB-681 review C4 means a stale record is no reason to skip sharing
    // in the first place: `servicesToShare` selects on eligibility alone.
    expect(servicesToShare(discovery).map((s) => s.key)).toEqual(['mailpit']);
  });

  it('reports an unclaimable (zero-rule) Drupal service as nothing to share', () => {
    const unprepared = service({
      key: 'drupal-admin',
      rules: [],
      limitation: 'project setup required',
    });
    const discovery: ClaimedDiscovery = { services: [unprepared] };
    expect(servicesToShare(discovery)).toEqual([]);
  });
});

describe('isLegacyKillCandidate (AC6)', () => {
  it('a deleted cwd is a candidate on its own, no legacy file needed', () => {
    expect(isLegacyKillCandidate({ deleted: true, pid: 123 }, null)).toBe(true);
  });

  it('a live cwd is NOT a candidate without legacy-file corroboration', () => {
    expect(isLegacyKillCandidate({ deleted: false, pid: 123 }, null)).toBe(
      false,
    );
    expect(
      isLegacyKillCandidate({ deleted: false, pid: 123 }, new Set([456])),
    ).toBe(false);
  });

  it('a live cwd IS a candidate when its old legacy file still names this pid', () => {
    expect(
      isLegacyKillCandidate({ deleted: false, pid: 123 }, new Set([123])),
    ).toBe(true);
  });
});

describe('revalidatesForKill (AC6)', () => {
  const proc = {
    cmdline: 'cloudflared tunnel --url http://x',
    deleted: true,
    startTime: 1000,
  };

  it('passes when cmdline, deleted and start time all still match', () => {
    expect(
      revalidatesForKill({ cmdline: proc.cmdline, deleted: true }, 1000, proc),
    ).toBe(true);
  });

  it('fails when the process is gone', () => {
    expect(revalidatesForKill(null, null, proc)).toBe(false);
  });

  it('fails on a cmdline mismatch (pid reuse)', () => {
    expect(
      revalidatesForKill(
        { cmdline: 'some other process', deleted: true },
        1000,
        proc,
      ),
    ).toBe(false);
  });

  it('fails on a start-time mismatch even when cmdline/deleted still match (stronger PID-reuse guard)', () => {
    expect(
      revalidatesForKill({ cmdline: proc.cmdline, deleted: true }, 2000, proc),
    ).toBe(false);
  });

  it('degrades to the cmdline/cwd check when start time could not be read on either side', () => {
    const noStartTime = { ...proc, startTime: null };
    expect(
      revalidatesForKill(
        { cmdline: proc.cmdline, deleted: true },
        null,
        noStartTime,
      ),
    ).toBe(true);
  });
});

describe('quickTunnelNotice', () => {
  it('flags a real trycloudflare.com allocation', () => {
    expect(quickTunnelNotice('https://route-100.trycloudflare.com')).toMatch(
      /Quick Tunnel/,
    );
  });

  it('returns undefined for a Named Cloudflare/frp fixed URL', () => {
    expect(
      quickTunnelNotice('https://bb-1-mailpit.example.org'),
    ).toBeUndefined();
  });

  it('returns undefined when there is no URL yet', () => {
    expect(quickTunnelNotice(undefined)).toBeUndefined();
  });

  // BB-681 review N8: state only validates `url` as a string, never as a
  // well-formed URL — a malformed stored value must never crash `status`.
  it('returns undefined for a malformed stored URL instead of throwing', () => {
    expect(() => quickTunnelNotice('not a url')).not.toThrow();
    expect(quickTunnelNotice('not a url')).toBeUndefined();
  });
});

describe('ports list without a ports addon entry', () => {
  it('ports list works without an entry', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bakers-ports-list-'));
    vi.stubEnv('BAKERS_HOME', home);
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const program = new Command();
      registerPorts(program, () => home);
      await program.parseAsync(['ports', 'list'], { from: 'user' });
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(out[0]).toBe(
      `tunnel sharing off (${PORTS_NEEDS_ENTRY}) — listing only\n`,
    );
    process.exitCode = undefined;
  });
});

describe('ports list with a malformed ports entry', () => {
  it('list fails naming the file and key for a malformed entry', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bakers-ports-list-'));
    const wt = mkdtempSync(join(tmpdir(), 'bakers-ports-wt-'));
    mkdirSync(join(wt, '.bakers'));
    const config = join(wt, '.bakers', 'project.config.js');
    writeFileSync(
      config,
      "export default { project: { name: 'demo' }, addons: [{ use: '@bakers-build/addon-ports', with: { services: [{ key: 'docs', match: 'a' }, { key: 'docs', match: 'b' }] } }] };",
    );
    vi.stubEnv('BAKERS_HOME', home);
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const program = new Command();
      registerPorts(program, () => wt);
      await program.parseAsync(['ports', 'list'], { from: 'user' });
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(out).toEqual([
      `${config}: addons[@bakers-build/addon-ports].with.services[1].key duplicates 'docs'\n`,
    ]);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe('ports list with the retired machine ports key', () => {
  it('still lists in listing-only mode', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bakers-ports-list-'));
    const wt = mkdtempSync(join(tmpdir(), 'bakers-ports-wt-'));
    writeFileSync(
      join(home, 'machine.config.js'),
      "export default { machine_id: 'm1', label: 'test', ports: { transport: { use: 'old-t' } } };",
    );
    vi.stubEnv('BAKERS_HOME', home);
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const program = new Command();
      registerPorts(program, () => wt);
      await program.parseAsync(['ports', 'list'], { from: 'user' });
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
    // BAKERS-159: the machine schema now refuses the retired key at load.
    expect(out[0]).toBe(
      `tunnel sharing off (${join(home, 'machine.config.js')}: ports is retired: configure it as addons: [{ use: '@bakers-build/addon-ports', with: … }]) — listing only\n`,
    );
    process.exitCode = undefined;
  });
});

describe('ports up/down/status/reap through the conductor (AC5, AC6)', () => {
  async function run(args: string[], wt: string, home: string) {
    vi.stubEnv('BAKERS_HOME', home);
    const out: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        out.push(String(chunk));
        return true;
      });
    try {
      const program = new Command();
      registerPorts(program, () => wt);
      await program.parseAsync(['ports', ...args], { from: 'user' });
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
    const exitCode = process.exitCode;
    process.exitCode = undefined;
    return { out: out.join(''), exitCode };
  }

  function endpoint(home: string, body: object): void {
    mkdirSync(join(home, 'conductors'), { recursive: true });
    writeFileSync(join(home, 'conductors', 'c1.json'), JSON.stringify(body));
  }

  it('fails naming the conductor and writes no state when none runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bakers-ports-home-'));
    const wt = mkdtempSync(join(tmpdir(), 'bakers-ports-wt-'));
    for (const args of [['up', 'web'], ['down'], ['status'], ['reap']]) {
      const { out, exitCode } = await run(args, wt, home);
      expect(out).toMatch(/no running conductor.*bakers conductor start/);
      expect(exitCode).toBe(1);
    }
    // A dead pid is no conductor either.
    endpoint(home, {
      url: 'http://127.0.0.1:9',
      operatorToken: 't',
      workspaceRoot: '/',
      pid: 2 ** 22 + 7,
    });
    expect((await run(['up', 'web'], wt, home)).out).toMatch(
      /no running conductor/,
    );
    expect(readdirSync(home).sort()).toEqual(['conductors']);
  });

  it("calls the conductor's tool with the operator token, cwd and ticket, and prints its answer", async () => {
    const home = mkdtempSync(join(tmpdir(), 'bakers-ports-home-'));
    const wt = mkdtempSync(join(tmpdir(), 'bakers-ports-wt-'));
    const seen: unknown[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        seen.push({ auth: req.headers.authorization, url: req.url, ...parsed });
        res.writeHead(parsed.tool === 'ports_down' ? 422 : 200, {
          'content-type': 'application/json',
        });
        res.end(
          JSON.stringify(
            parsed.tool === 'ports_status'
              ? {
                  text: JSON.stringify([
                    {
                      service: 'web',
                      status: 'applied',
                      local: 'http://x',
                      url: 'https://u',
                    },
                  ]),
                }
              : parsed.tool === 'ports_down'
                ? { error: 'nothing to stop' }
                : { text: 'shared at https://u' },
          ),
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    endpoint(home, {
      url: `http://127.0.0.1:${port}`,
      operatorToken: 'op-token',
      workspaceRoot: tmpdir(),
      pid: process.pid,
    });
    try {
      const up = await run(['up', 'web', '--ticket', 'BB-7'], wt, home);
      expect(up).toEqual({ out: 'shared at https://u\n', exitCode: undefined });
      expect(seen[0]).toEqual({
        auth: 'Bearer op-token',
        url: '/call',
        tool: 'ports_up',
        args: { service: 'web' },
        worktree: wt,
        ticket: 'BB-7',
      });
      expect((await run(['status'], wt, home)).out).toBe(
        'web\thttps://u\tapplied\n',
      );
      expect(await run(['down', 'web'], wt, home)).toEqual({
        out: 'nothing to stop\n',
        exitCode: 1,
      });
    } finally {
      server.close();
    }
  });
});
