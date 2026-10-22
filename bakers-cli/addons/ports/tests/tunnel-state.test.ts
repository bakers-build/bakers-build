import { describe, expect, it } from 'vitest';
import {
  assertIdentity,
  readMachineTunnelState,
  readTunnelState,
  readValidatedMachineState,
  type TunnelDesiredRecord,
  TunnelIdentityMismatchError,
  type TunnelStateDeps,
  upsertRecord,
  writeMachineTunnelState,
} from '../src/tunnel-state.js';

const IDENTITY = { transport: 'cloudflare', identity: 'acc-1/tun-1/zone-1' };

function fakeDeps(
  initial: Record<string, string> = {},
): TunnelStateDeps & { files: Record<string, string> } {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    readFile: async (path) => {
      if (!(path in files)) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return files[path]!;
    },
    writeFile: async (path, data) => {
      files[path] = data;
    },
    rename: async (from, to) => {
      files[to] = files[from]!;
      delete files[from];
    },
    mkdir: async () => {},
  };
}

const record = (
  over: Partial<TunnelDesiredRecord> = {},
): TunnelDesiredRecord => ({
  worktree: '/wt/pynq-42',
  ticket: 'pynq-42',
  key: 'drupal',
  hostname: 'pynq-42-drupal.preview.example',
  service: 'https://127.0.0.1:443',
  desired: 'present',
  applied: 'applied',
  ...over,
});

describe('readMachineTunnelState', () => {
  it('reads missing as `missing`, never as a crash', async () => {
    const deps = fakeDeps();
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('reads malformed JSON as `malformed`, not as empty', async () => {
    const deps = fakeDeps({ '/home/.bakers/tunnels.json': '{not json' });
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('reads a permission error as `permission`', async () => {
    const deps = fakeDeps();
    deps.readFile = async () => {
      const err = new Error('denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: false, reason: 'permission' });
  });

  it('reads an old schema-1 file as `malformed` — never silently migrated', async () => {
    const deps = fakeDeps({
      '/home/.bakers/tunnels.json': JSON.stringify({
        schemaVersion: 1,
        accountId: 'acc-1',
        tunnelId: 'tun-1',
        zoneId: 'zone-1',
        zone: 'preview.example',
        records: [],
      }),
    });
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('rejects a record with an unknown field rather than silently dropping it', async () => {
    const deps = fakeDeps({
      '/home/.bakers/tunnels.json': JSON.stringify({
        schemaVersion: 2,
        ...IDENTITY,
        records: [{ ...record(), dnsRecordId: 'rec-1' }],
      }),
    });
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('keeps a direct origin through a round-trip; an old record without one stays valid', async () => {
    const deps = fakeDeps();
    const withDirect = record({ direct: 'http://172.18.0.19:80' });
    const old = record({ key: 'mailpit' });
    await writeMachineTunnelState(
      '/home/.bakers',
      { schemaVersion: 2, ...IDENTITY, records: [withDirect, old] },
      deps,
    );
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({
      ok: true,
      state: { records: [withDirect, old] },
    });
  });

  it('rejects a non-string direct origin as malformed', async () => {
    const deps = fakeDeps({
      '/home/.bakers/tunnels.json': JSON.stringify({
        schemaVersion: 2,
        ...IDENTITY,
        records: [{ ...record(), direct: 42 }],
      }),
    });
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('round-trips a written state atomically', async () => {
    const deps = fakeDeps();
    await writeMachineTunnelState(
      '/home/.bakers',
      { schemaVersion: 2, ...IDENTITY, records: [record()] },
      deps,
    );
    const result = await readMachineTunnelState('/home/.bakers', deps);
    expect(result).toMatchObject({ ok: true, state: { records: [record()] } });
    expect(
      Object.keys(deps.files).filter((k) => k.includes('.tmp')),
    ).toHaveLength(0);
  });
});

describe('assertIdentity / readValidatedMachineState', () => {
  it('throws on a different identity while records remain, rather than silently reusing it', async () => {
    const deps = fakeDeps();
    await writeMachineTunnelState(
      '/home/.bakers',
      {
        schemaVersion: 2,
        transport: 'cloudflare',
        identity: 'OTHER',
        records: [record()],
      },
      deps,
    );
    await expect(
      readValidatedMachineState('/home/.bakers', IDENTITY, deps),
    ).rejects.toThrow(TunnelIdentityMismatchError);
  });

  it('an empty record set CAN bind a new identity (no throw)', async () => {
    const deps = fakeDeps();
    await writeMachineTunnelState(
      '/home/.bakers',
      {
        schemaVersion: 2,
        transport: 'cloudflare',
        identity: 'OTHER',
        records: [],
      },
      deps,
    );
    const state = await readValidatedMachineState(
      '/home/.bakers',
      IDENTITY,
      deps,
    );
    expect(state).toEqual({ schemaVersion: 2, ...IDENTITY, records: [] });
  });

  it('token rotation alone (same identity) is fine and does not trip the check', async () => {
    const deps = fakeDeps();
    await writeMachineTunnelState(
      '/home/.bakers',
      { schemaVersion: 2, ...IDENTITY, records: [record()] },
      deps,
    );
    // Same transport + identity — a rotated token lives in `settings`, which
    // never reaches `tunnels.json` or this identity check at all.
    const state = await readValidatedMachineState(
      '/home/.bakers',
      IDENTITY,
      deps,
    );
    expect(state.records).toHaveLength(1);
  });

  it('a missing file resolves to a fresh empty state under the given identity', async () => {
    const deps = fakeDeps();
    const state = await readValidatedMachineState(
      '/home/.bakers',
      IDENTITY,
      deps,
    );
    expect(state).toEqual({ schemaVersion: 2, ...IDENTITY, records: [] });
  });

  it('malformed content blocks the mutation (throws), never masquerades as empty', async () => {
    const deps = fakeDeps({ '/home/.bakers/tunnels.json': '{bad' });
    await expect(
      readValidatedMachineState('/home/.bakers', IDENTITY, deps),
    ).rejects.toThrow();
  });

  it('a schema-1 file blocks mutation rather than being silently coerced', async () => {
    const deps = fakeDeps({
      '/home/.bakers/tunnels.json': JSON.stringify({
        schemaVersion: 1,
        accountId: 'acc-1',
        tunnelId: 'tun-1',
        zoneId: 'zone-1',
        zone: 'preview.example',
        records: [],
      }),
    });
    await expect(
      readValidatedMachineState('/home/.bakers', IDENTITY, deps),
    ).rejects.toThrow();
  });

  it('assertIdentity is a pure check callers can use directly', () => {
    expect(() => assertIdentity(IDENTITY, IDENTITY)).not.toThrow();
    expect(() =>
      assertIdentity({ transport: 'cloudflare', identity: 'other' }, IDENTITY),
    ).toThrow(TunnelIdentityMismatchError);
  });
});

describe('readTunnelState (list view)', () => {
  it('filters to one worktree and never throws on a bad file', async () => {
    const deps = fakeDeps();
    await writeMachineTunnelState(
      '/home/.bakers',
      {
        schemaVersion: 2,
        ...IDENTITY,
        records: [record({ worktree: '/wt/a' }), record({ worktree: '/wt/b' })],
      },
      deps,
    );
    expect(await readTunnelState('/wt/a', '/home/.bakers', deps)).toHaveLength(
      1,
    );
    expect(
      await readTunnelState('/wt/missing', '/home/.bakers', deps),
    ).toHaveLength(0);

    const brokenDeps = fakeDeps({ '/home/.bakers/tunnels.json': 'not json' });
    await expect(
      readTunnelState('/wt/a', '/home/.bakers', brokenDeps),
    ).resolves.toEqual([]);
  });
});

describe('upsertRecord', () => {
  it('inserts a new (worktree, key) pair and replaces an existing one in place', () => {
    const base = [record()];
    const inserted = upsertRecord(base, record({ key: 'mailpit' }));
    expect(inserted).toHaveLength(2);

    const replaced = upsertRecord(
      inserted,
      record({ applied: 'error', error: 'boom' }),
    );
    expect(replaced).toHaveLength(2);
    expect(replaced.find((r) => r.key === 'drupal')).toMatchObject({
      applied: 'error',
      error: 'boom',
    });
  });
});
