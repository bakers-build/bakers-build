import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AddonEntry,
  discoverAddons,
  loadAddonPreset,
  resolveConductorSlots,
} from '../../src/index.js';

// BB-215 AC-1 / AC-2: the shared addon-discovery engine. These exercise the
// engine mechanics against tmp preset fixtures (a preset module is any module
// exporting the named per-surface accumulator functions). The cross-addon
// discovery over the REAL shipped addons (AC-3) lives in the conductor suite.

let dir: string;
let bases: string[];

function fixture(name: string, body: string): void {
  writeFileSync(join(dir, name), body);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bakers-addons-'));
  bases = [pathToFileURL(`${dir}/`).href];
});

// A herdr-style addon: ONE entry contributing BOTH executor + worktree.
const HERDR_PRESET = `
export const executors  = (acc, opts) => [...acc, { kind: 'executor',  id: opts?.id ?? 'herdr', requiredModules: [] }];
export const worktrees  = (acc, opts) => [...acc, { kind: 'worktree', id: opts?.id ?? 'herdr', requiredModules: [] }];
`;
const AGENT_PRESET = (id: string) => `
export const agents = (acc) => [...acc, { agent: { kind: 'agent', id: '${id}', requiredModules: [] } }];
`;
const REMOTE_PRESET = (id: string) => `
export const servers = (acc) => [...acc, { kind: 'server', id: '${id}', requiredModules: [] }];
`;
const CONNECTION_PRESET = `
export const connectionPlugins = (acc) => [...acc, { kind: 'auth', id: 'oauth2', requiredModules: [] }];
`;

describe('discoverAddons — surface routing', () => {
  it('AC-1: reads executor + worktree from ONE preset entry (no kind wiring)', async () => {
    fixture('herdr.js', HERDR_PRESET);
    const out = await discoverAddons(['./herdr.js'], 'conductor', bases);
    expect(out.executors.map((p) => p.id)).toEqual(['herdr']);
    expect(out.worktrees.map((p) => p.id)).toEqual(['herdr']);
    // resolveConductorSlots wires both slots from the single entry (the
    // engine-internal slot name stays `workspace`).
    const slots = resolveConductorSlots(out);
    expect(slots.executor?.kind).toBe('executor');
    expect(slots.workspace?.kind).toBe('worktree');
  });

  it('runs ONLY the requested surface accumulators', async () => {
    fixture('both.js', `${HERDR_PRESET}\n${CONNECTION_PRESET}`);
    const asConductor = await discoverAddons(['./both.js'], 'conductor', bases);
    expect(asConductor.executors).toHaveLength(1);
    expect(asConductor.connectionPlugins).toHaveLength(0);
    const asConnection = await discoverAddons(
      ['./both.js'],
      'connection',
      bases,
    );
    expect(asConnection.connectionPlugins).toHaveLength(1);
    expect(asConnection.executors).toHaveLength(0);
  });

  it('passes the entry `with` to the accumulator as opts', async () => {
    fixture('herdr.js', HERDR_PRESET);
    const out = await discoverAddons(
      [{ use: './herdr.js', with: { id: 'custom' } }],
      'conductor',
      bases,
    );
    expect(out.executors[0]?.id).toBe('custom');
  });
});

describe('discoverAddons — singleton resolution (last wins + warn + guard)', () => {
  it('takes the LAST contributor for a singleton slot', async () => {
    fixture('a.js', REMOTE_PRESET('first'));
    fixture('b.js', REMOTE_PRESET('second'));
    const out = await discoverAddons(['./a.js', './b.js'], 'conductor', bases);
    expect(out.servers.map((r) => r.id)).toEqual(['first', 'second']);
    const slots = resolveConductorSlots(out);
    expect(slots.remote?.id).toBe('second');
  });

  it('the runtime .kind guard rejects a mis-declared singleton', async () => {
    // A preset that pushes a worktree-kinded plugin into the executors list.
    fixture(
      'bad.js',
      `export const executors = (acc) => [...acc, { kind: 'worktree', id: 'oops', requiredModules: [] }];`,
    );
    const out = await discoverAddons(['./bad.js'], 'conductor', bases);
    expect(() => resolveConductorSlots(out)).toThrow(/executor/);
  });

  it('the runtime slot takes the last runtimes contribution', async () => {
    const runtime = (id: string) =>
      `export const runtimes = (acc) => [...acc, { kind: 'runtime', id: '${id}', isolates: true, requiredModules: [] }];`;
    fixture('r1.js', runtime('one'));
    fixture('r2.js', runtime('docker'));
    const out = await discoverAddons(
      ['./r1.js', './r2.js'],
      'conductor',
      bases,
    );
    expect(resolveConductorSlots(out).runtime?.id).toBe('docker');
    const narrowed = await discoverAddons(['./r2.js'], 'conductor', bases, {
      only: ['runtimes'],
    });
    expect(narrowed.runtimes).toHaveLength(1);
  });

  it('the runtime slot rejects a contribution of another kind', async () => {
    fixture(
      'bad-runtime.js',
      `export const runtimes = (acc) => [...acc, { kind: 'executor', id: 'oops', requiredModules: [] }];`,
    );
    const out = await discoverAddons(['./bad-runtime.js'], 'conductor', bases);
    expect(() => resolveConductorSlots(out)).toThrow(
      "addon contributed a 'executor' into the runtime slot",
    );
  });
});

describe('discoverAddons — agents (candidate list + priority)', () => {
  it('collects agent candidates and attaches the entry priority', async () => {
    fixture('codex.js', AGENT_PRESET('codex'));
    fixture('claude.js', AGENT_PRESET('claude'));
    const priority = () => 100;
    const entries: AddonEntry[] = [
      { use: './codex.js', priority },
      './claude.js',
    ];
    const out = await discoverAddons(entries, 'conductor', bases);
    expect(out.agents.map((c) => c.agent.id)).toEqual(['codex', 'claude']);
    expect(out.agents[0]?.priority).toBe(priority);
    expect(out.agents[1]?.priority).toBeUndefined();
  });
});

describe('discoverAddons — meta-addon composition', () => {
  it('applies a preset`s addons children DEPTH-FIRST before the parent', async () => {
    fixture('child.js', REMOTE_PRESET('child'));
    // The parent declares the child in its own `addons` and also contributes.
    fixture(
      'parent.js',
      `export const addons = ['./child.js'];\nexport const servers = (acc) => [...acc, { kind: 'server', id: 'parent', requiredModules: [] }];`,
    );
    const out = await discoverAddons(['./parent.js'], 'conductor', bases);
    // child before parent → parent (listed last) wins the singleton.
    expect(out.servers.map((r) => r.id)).toEqual(['child', 'parent']);
    expect(resolveConductorSlots(out).remote?.id).toBe('parent');
  });

  it('dedups an EXACT duplicate addon (same path + same opts) — processed once', async () => {
    fixture('dup.js', REMOTE_PRESET('dup'));
    const out = await discoverAddons(
      ['./dup.js', './dup.js'],
      'conductor',
      bases,
    );
    expect(out.servers.map((r) => r.id)).toEqual(['dup']);
  });

  it('keeps the SAME package with DIFFERENT opts (multi-instance, e.g. oauth profiles)', async () => {
    // A connection addon whose factory ids itself from opts.id — two entries,
    // one package, two profiles: both must survive dedup.
    fixture(
      'oauth.js',
      `export const connectionPlugins = (acc, opts) => [...acc, { kind: 'auth', id: opts?.id ?? 'oauth', requiredModules: [] }];`,
    );
    const out = await discoverAddons(
      [
        { use: './oauth.js', with: { id: 'session' } },
        { use: './oauth.js', with: { id: 'pm' } },
      ],
      'connection',
      bases,
    );
    expect(out.connectionPlugins.map((p) => p.id)).toEqual(['session', 'pm']);
  });
});

describe('discoverAddons — legacy default-export fallback', () => {
  it('adapts a non-preset package default export by its plugin kind', async () => {
    // No named accumulators, no ./preset — just a default factory (legacy).
    fixture(
      'legacy.js',
      `export default (opts) => ({ kind: 'executor', id: opts?.id ?? 'legacy', requiredModules: [] });`,
    );
    const out = await discoverAddons(
      [{ use: './legacy.js', with: { id: 'adapted' } }],
      'conductor',
      bases,
    );
    expect(out.executors.map((p) => p.id)).toEqual(['adapted']);
  });
});

const UI_PRESET = `
export const uiEntries = (acc) => [...acc, './tab.js'];
export const connectionPlugins = (acc) => [...acc, { kind: 'auth', id: 'nope', requiredModules: [] }];
`;

describe('discoverAddons — narrowed keys and degraded resolution', () => {
  it('runs only the keys named in `only`', async () => {
    fixture('ui.js', UI_PRESET);
    const out = await discoverAddons(['./ui.js'], 'connection', bases, {
      only: ['uiEntries'],
    });
    expect(out.uiEntries).toEqual(['./tab.js']);
    expect(out.connectionPlugins).toHaveLength(0);
  });

  it('intersects `only` with the surface, never widening it', async () => {
    fixture('ui.js', UI_PRESET);
    const out = await discoverAddons(['./ui.js'], 'conductor', bases, {
      only: ['uiEntries'],
    });
    expect(out.uiEntries).toEqual([]);
  });

  it('throws on an unresolvable addon by default', async () => {
    await expect(
      discoverAddons(['./missing.js'], 'connection', bases),
    ).rejects.toThrow("cannot resolve addon './missing.js'");
  });

  it('skips an unresolvable addon and names package and source', async () => {
    fixture('ui.js', UI_PRESET);
    const warnings: string[] = [];
    const logger = {
      warn: (_o: unknown, msg: string) => warnings.push(msg),
    } as unknown as Parameters<typeof discoverAddons>[3]['logger'];
    const out = await discoverAddons(
      ['./missing.js', './ui.js'],
      'connection',
      bases,
      {
        only: ['uiEntries'],
        unresolved: 'skip',
        source: '/home/x/.bakers/machine.config.js',
        logger,
      },
    );
    expect(out.uiEntries).toEqual(['./tab.js']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('/home/x/.bakers/machine.config.js');
    expect(warnings[0]).toContain("cannot resolve addon './missing.js'");
  });

  it('still throws when a resolvable preset throws on import', async () => {
    fixture('boom.js', `throw new Error('preset exploded');`);
    await expect(
      discoverAddons(['./boom.js'], 'connection', bases, {
        unresolved: 'skip',
      }),
    ).rejects.toThrow('preset exploded');
  });
});

describe('discoverAddons — lifecycle hook listeners', () => {
  const HOOK_PRESET = (id: string) => `
export const hooks = async (acc) => [...acc, { id: '${id}', before_run: () => {} }];
`;

  it('collects a hook-only preset in order, children before the parent', async () => {
    fixture('child.js', HOOK_PRESET('child'));
    fixture(
      'parent.js',
      `export const addons = ['./child.js'];\n${HOOK_PRESET('parent')}`,
    );
    fixture('last.js', HOOK_PRESET('last'));
    const out = await discoverAddons(
      ['./parent.js', './last.js', './last.js'],
      'conductor',
      bases,
    );
    expect(out.hooks.map((h) => (h as { id: string }).id)).toEqual([
      'child',
      'parent',
      'last',
    ]);
  });

  it('runs hook accumulators on the conductor surface only', async () => {
    let calls = 0;
    (globalThis as { __hookCalls?: () => void }).__hookCalls = () => {
      calls += 1;
    };
    fixture(
      'counted.js',
      `export const hooks = (acc) => { globalThis.__hookCalls(); return [...acc, {}]; };
export const commands = (acc) => acc;
export const connectionPlugins = (acc) => acc;`,
    );
    await discoverAddons(['./counted.js'], 'connection', bases);
    await discoverAddons(['./counted.js'], 'command', bases);
    await discoverAddons(['./counted.js'], 'conductor', bases, {
      only: ['agents'],
    });
    expect(calls).toBe(0);
    const out = await discoverAddons(['./counted.js'], 'conductor', bases);
    expect(calls).toBe(1);
    expect(out.hooks).toHaveLength(1);
  });
});

describe('discoverAddons — scopes and per-entry bases', () => {
  it('a preset exporting only scopes is accepted', async () => {
    fixture('scoped.js', `export const scopes = ['machine'];`);
    const { preset } = await loadAddonPreset('./scoped.js', bases);
    expect(preset.scopes).toEqual(['machine']);
    const out = await discoverAddons(['./scoped.js'], 'conductor', bases);
    expect(out.agents).toEqual([]);
  });

  it('entryBases resolves each entry against its own bases', async () => {
    const machineDir = mkdtempSync(join(tmpdir(), 'bakers-addons-m-'));
    const projectDir = mkdtempSync(join(tmpdir(), 'bakers-addons-p-'));
    writeFileSync(join(machineDir, 'agent.js'), AGENT_PRESET('m'));
    writeFileSync(join(projectDir, 'remote.js'), REMOTE_PRESET('p'));
    const out = await discoverAddons(
      ['./agent.js', './remote.js'],
      'conductor',
      bases,
      {
        entryBases: [
          [pathToFileURL(`${machineDir}/`).href],
          [pathToFileURL(`${projectDir}/`).href],
        ],
      },
    );
    expect(
      out.agents.map((c) => (c as { agent: { id: string } }).agent.id),
    ).toEqual(['m']);
    expect(out.servers.map((r) => (r as { id: string }).id)).toEqual(['p']);
  });
});

describe('runtime declarations', () => {
  it('unions declarations including nested presets and routes runtime globals only to runtimes', async () => {
    fixture('paths.js', `export const runtime = { read_only: ['.ddev'] };`);
    fixture(
      'runtime.js',
      `export const addons = ['./paths.js']; export const runtime = { read_only: ['.ddev', 'scripts'] }; export const runtimes = (acc, opts) => [...acc, opts]; export const agents = (acc, opts) => [...acc, opts];`,
    );
    const out = await discoverAddons(['./runtime.js'], 'conductor', bases, {
      runtimeGlobals: { shared_runtime: { project: { read_only: [] } } },
    });
    expect(out.runtimeReadOnly).toEqual(['.ddev', 'scripts']);
    expect(out.runtimes).toEqual([
      { shared_runtime: { project: { read_only: [] } } },
    ]);
    expect(out.agents).toEqual([undefined]);
  });
});
