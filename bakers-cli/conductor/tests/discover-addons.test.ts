import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  discoverAddons,
  emptyContributions,
  loadBbConfig,
} from '@bakers-build/core';
import { describe, expect, it, vi } from 'vitest';
import { loadConductorConfig } from '../src/config.js';

// Agents are a per-machine concern: the base catalog is sourced from the machine
// context's addons[], so discovery is exercised with a fixed machine catalog.
const machine = vi.hoisted(() => ({
  agentAddons: ['@bakers-build/addon-codex'] as string[],
  catalog: undefined as unknown[] | undefined,
}));
vi.mock('@bakers-build/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bakers-build/core')>()),
  readMachineContext: async () => ({
    addons: machine.agentAddons,
    ...(machine.catalog ? { agents: { catalog: machine.catalog } } : {}),
  }),
}));

// BB-215 AC-2 / AC-3: end-to-end addon discovery over the REAL shipped addons,
// through the actual conductor + connection loaders — a config that names ONLY
// packages in addons[] (no export:/kind wiring) wires every slot.

// ESLint-style bases = the META package (@bakers-build/bakers, host/), the
// production-faithful resolution context where a global install keeps EVERY
// addon (conductor + connection + command) under one node_modules. The engine
// only deps @bakers-build/core, so it cannot resolve the ui/dropsh command addons —
// only the host can. @bakers-build/addon-fake resolves from its own dir (fixture,
// never published).
const bases = [new URL('../../host/package.json', import.meta.url).href];

function writeConductorConfig(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakers-addons-cfg-'));
  const file = join(dir, 'conductor.config.js');
  writeFileSync(file, body);
  return file;
}

describe('loadConductorConfig — addons[] discovery (AC-2)', () => {
  it('wires remote/executor/workspace from addons[] and agents from the machine', async () => {
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' },
  states: ['working'],
  addons: [
    '@bakers-build/addon-remote-drupal',
    '@bakers-build/addon-herdr',
  ],
};
`);
    const cfg = await loadConductorConfig(file);
    expect(cfg.remote.kind).toBe('remote'); // drupalRemote via addon-remote-drupal
    expect(cfg.remote.id).toBe('drupal');
    expect(cfg.executor.kind).toBe('executor'); // herdr
    expect(cfg.executor.id).toBe('herdr');
    expect(cfg.workspace.kind).toBe('workspace'); // herdr (SAME single entry)
    expect(cfg.workspace.id).toBe('herdr');
    // agent candidate list from the machine's agent_addons (codex)
    expect(cfg.agents.map((c) => ({ alias: c.alias, id: c.agent.id }))).toEqual(
      [
        { alias: 'codex', id: 'codex' },
        { alias: 'astra', id: 'codex' },
        { alias: 'sol', id: 'codex' },
        { alias: 'terra', id: 'codex' },
        { alias: 'luna', id: 'codex' },
      ],
    );
  });

  it('a herdr entry listed ONCE wires executor + workspace (retires herdrWorkspace export)', async () => {
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
`);
    const cfg = await loadConductorConfig(file);
    expect(cfg.executor.id).toBe('herdr');
    expect(cfg.workspace.id).toBe('herdr');
    expect(typeof cfg.processHost?.spawn).toBe('function');
  });

  it('an explicit herdr executor slot still contributes a process host', async () => {
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  remote: { plugin: '@bakers-build/addon-remote-drupal' },
  executor: { plugin: '@bakers-build/addon-herdr' },
  workspace: { plugin: '@bakers-build/addon-herdr', export: 'herdrWorkspace' },
};
`);
    const cfg = await loadConductorConfig(file);
    expect(typeof cfg.processHost?.spawn).toBe('function');
  });

  it('an explicit per-slot descriptor WINS over a discovered contributor (back-compat)', async () => {
    // addon-remote-drupal would contribute the drupal remote; the explicit slot
    // overrides it.
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
  remote: { kind: 'remote', id: 'explicit-remote', requiredModules: [] },
};
`);
    const cfg = await loadConductorConfig(file);
    expect(cfg.remote.id).toBe('explicit-remote');
  });
});

describe('loadConductorConfig — lifecycle hook listeners', () => {
  const writeAddon = (dir: string, name: string, body: string): string => {
    const file = join(dir, name);
    writeFileSync(file, body);
    return file;
  };

  it('loads hook listeners from conductor addons in order and keeps shell hooks as strings', async () => {
    const file = writeConductorConfig('');
    const dir = join(file, '..');
    writeAddon(
      dir,
      'child.mjs',
      `export const hooks = async (acc) => [...acc, { id: 'child', after_create() {} }];`,
    );
    writeAddon(
      dir,
      'parent.mjs',
      `export const addons = ['./child.mjs'];
export const hooks = (acc) => [...acc, {
  id: 'parent',
  after_create() {}, before_run() {}, async after_run() {}, after_done() {},
}];`,
    );
    writeFileSync(
      file,
      `export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr', './parent.mjs', './parent.mjs'],
  hooks: { before_run: 'echo shell' },
};
`,
    );
    const cfg = await loadConductorConfig(file);
    expect(cfg.hookListeners?.map((l) => l.id)).toEqual([
      'herdr-frozen-marker',
      'child',
      'parent',
    ]);
    const parent = cfg.hookListeners?.[2];
    for (const slot of [
      'after_create',
      'before_run',
      'after_run',
      'after_done',
    ] as const) {
      expect(typeof parent?.[slot]).toBe('function');
    }
    expect(cfg.hooks).toEqual({ before_run: 'echo shell' });
  });

  it('loads the hooks guide example, whose before_run adds the env key it documents', async () => {
    const guide = readFileSync(
      new URL(
        '../../../docs/configuration/provisioning/hooks.md',
        import.meta.url,
      ),
      'utf8',
    );
    const section = guide.split('## Add a listener from an addon')[1] ?? '';
    const example = /```ts\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
    // The guide's TypeScript, minus its type-only syntax, as a plain preset.
    const js = example
      .replace(/^import type .*\n/m, '')
      .replace(": Preset['hooks']", '');
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr', './guide.mjs'],
};
`);
    writeAddon(join(file, '..'), 'guide.mjs', js);
    const cfg = await loadConductorConfig(file);
    const listener = cfg.hookListeners?.find((l) => l.id === 'demo-sidecar');
    expect(listener).toBeDefined();
    const env: Record<string, string> = {};
    await listener?.before_run?.({
      worktreePath: '/wt',
      ticket: {} as never,
      state: 'working',
      env,
      run: { uuid: 'r-1' },
    });
    expect(env).toEqual({ DEMO_SIDECAR_URL: 'http://127.0.0.1:4599' });
    expect(typeof listener?.after_run).toBe('function');
  });

  // BB-599 holds through the scope declaration: a hook addon declares the
  // project scope only, so listing it in machine addons[] never loads it.
  it('never runs a hook accumulator of a project-only addon listed on the machine', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-machine-hooks-'));
    const hooky = writeAddon(
      dir,
      'hooky.mjs',
      `export const scopes = ['project'];
export const hooks = () => { throw new Error('machine hook accumulator ran'); };`,
    );
    machine.agentAddons = ['@bakers-build/addon-codex', hooky];
    try {
      const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
`);
      const cfg = await loadConductorConfig(file);
      expect(cfg.hookListeners?.map((l) => l.id)).toEqual([
        'herdr-frozen-marker',
      ]);
    } finally {
      machine.agentAddons = ['@bakers-build/addon-codex'];
    }
  });

  it('never runs a hook accumulator of a machine agent catalog variant', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-catalog-hooks-'));
    const hooky = writeAddon(
      dir,
      'hooky.mjs',
      `export const agents = (acc) => [...acc, { alias: 'hooky', description: 'Probe.', agent: { id: 'hooky' } }];
export const hooks = (acc, opts) => { if (opts?.probe) throw new Error('catalog hook accumulator ran'); return acc; };`,
    );
    machine.agentAddons = ['@bakers-build/addon-codex', hooky];
    machine.catalog = [
      { harness: hooky, alias: 'probe', with: { probe: true } },
    ];
    try {
      const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
};
`);
      const cfg = await loadConductorConfig(file);
      expect(cfg.hookListeners?.map((l) => l.id)).toEqual([
        'herdr-frozen-marker',
      ]);
    } finally {
      machine.agentAddons = ['@bakers-build/addon-codex'];
      machine.catalog = undefined;
    }
  });

  it.each([
    [
      'a non-array accumulator result',
      `export const hooks = () => ({});`,
      /hooks/,
    ],
    [
      'a non-callable hook slot',
      `export const hooks = (acc) => [...acc, { id: 'bad', before_run: 'echo' }];`,
      /before_run/,
    ],
  ])('rejects %s at config load', async (_name, body, message) => {
    const file = writeConductorConfig('');
    writeAddon(join(file, '..'), 'bad.mjs', body);
    writeFileSync(
      file,
      `export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr', './bad.mjs'],
};
`,
    );
    await expect(loadConductorConfig(file)).rejects.toThrow(message);
  });
});

describe('addon inbox discovery (contract 2, BB-661)', () => {
  // An inbox-only fixture package: its handlers echo the `with` options they
  // were built with, so the test sees discovery → loadInbox → handler.
  function inboxAddon(dir: string): void {
    mkdirSync(join(dir, 'demo'), { recursive: true });
    writeFileSync(
      join(dir, 'demo', 'package.json'),
      JSON.stringify({
        name: '@x/addon-demo',
        version: '0.3.0',
        type: 'module',
      }),
    );
    writeFileSync(
      join(dir, 'demo', 'preset.js'),
      `export const inbox = {
  contract: 2,
  label: 'Demo',
  messages: { ping: { label: 'Ping', access: 'view' } },
  handlers: async (options) => ({
    ping: async (request) => ({ markdown: request.id + ' ' + options?.greeting }),
  }),
};
`,
    );
  }
  const entry = { use: './demo/preset.js', with: { greeting: 'hi' } };
  const request = {
    id: 'req-1',
    messageType: 'demo.ping',
    addonVersion: '0.3.0',
    requestedBy: 'user-1',
    ticket: {} as never,
    worktreePath: '/tmp/demo',
    env: {},
    logger: { warn: () => {} } as never,
    signal: new AbortController().signal,
  };

  it('collects an inbox-only preset with name, version and `with` options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-addon-inbox-'));
    inboxAddon(dir);
    const bases = [pathToFileURL(`${dir}/`).href];
    const out = await discoverAddons([entry], 'conductor', bases);
    expect(out.addonInbox).toHaveLength(1);
    expect(out.addonInbox[0]).toMatchObject({
      name: 'demo',
      version: '0.3.0',
      options: { greeting: 'hi' },
      inbox: { contract: 2, label: 'Demo' },
    });
    for (const surface of ['command', 'connection'] as const) {
      expect(
        (await discoverAddons([entry], surface, bases)).addonInbox,
      ).toEqual([]);
    }
  });

  it('loadConductorConfig loads the discovered inbox and passes `with` to its handlers', async () => {
    const file = writeConductorConfig(`export default {
  bakers: { project: 'demo' }, states: ['working'],
  addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr', ${JSON.stringify(entry)}],
};
`);
    inboxAddon(join(file, '..'));
    const cfg = await loadConductorConfig(file);
    expect(cfg.inboxAddons?.map((a) => a.name)).toEqual(['demo']);
    const result = await cfg.inboxAddons?.[0]?.handlers.ping?.(request);
    expect(result).toEqual({ markdown: 'req-1 hi' });
  });
});

describe('loadBbConfig — addons[] discovery (AC-2, connection surface)', () => {
  it('resolves site + connection plugins from an addons[] (no plugins[])', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-conn-'));
    mkdirSync(join(root, '.bakers'));
    writeFileSync(
      join(root, '.bakers', 'bakers.config.js'),
      `export default {
  site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
  addons: ['@bakers-build/addon-essentials'],
};
`,
    );
    const host = { resolveBases: [import.meta.url] };
    const conn = await loadBbConfig(host, { cwd: root });
    expect(conn.site.base_url).toBe('https://x.test');
    // essentials flattens into its md + jsonapi-schema children.
    const ids = conn.plugins.map((p) => p?.id);
    expect(ids).toContain('markdown');
    expect(ids).toContain('jsonapi-schema');
  });

  // BB-373 — `ui_entries` comes out RESOLVED, as importable `file://` URLs.
  //
  // Resolution has to happen here, against the bases that found the addon's
  // `./preset`, and not at the import: the module that eventually imports an
  // entry is the TUI kernel inside `@bakers-build/addon-bakers-ui`, where a bare
  // specifier resolves against THAT package's dependencies — and a contribution
  // addon is its SIBLING, never its dependency. Measured before this was so:
  // `bakers ui BB-373` died with `Cannot find module
  // '@bakers-build/addon-bakers-ui-artifacts/ui' from .../addons/bakers-ui/dist/src/Extension/load.js`.
  it('resolves ui_entries to importable file URLs (BB-373)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-conn-ui-'));
    mkdirSync(join(root, '.bakers'));
    writeFileSync(
      join(root, '.bakers', 'bakers.config.js'),
      `export default {
  site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
  addons: ['@bakers-build/addon-bakers-ui-artifacts'],
};
`,
    );
    const conn = await loadBbConfig({ resolveBases: bases }, { cwd: root });

    expect(conn.ui_entries).toHaveLength(1);
    expect(conn.ui_entries[0]).toMatch(/^file:\/\//);
    // The workspace dir, not the package name: pnpm resolves the link to the
    // real path, so the assertion names what the resolver actually returns.
    expect(conn.ui_entries[0]).toContain('bakers-ui-artifacts');
    // Importable AS RESOLVED — the property the kernel depends on, asserted by
    // doing exactly what the kernel does rather than by inspecting the string.
    await expect(import(conn.ui_entries[0] as string)).resolves.toBeDefined();
  });

  it('leaves ui_entries empty for a config with no addons[] at all', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bakers-conn-noui-'));
    mkdirSync(join(root, '.bakers'));
    writeFileSync(
      join(root, '.bakers', 'bakers.config.js'),
      `export default { site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };
`,
    );
    const conn = await loadBbConfig({ resolveBases: bases }, { cwd: root });
    expect(conn.ui_entries).toEqual([]);
  });
});

// AC-3: every shipped addon resolves its ./preset and contributes ≥1 to its
// surface through discovery — no default-export fallback for a shipped addon.
describe('AC-3: all shipped addons contribute via ./preset discovery', () => {
  const conductorAddons = [
    // BB-224: the three impl addons that replaced `@bakers-build/core/builtins` +
    // the deleted `@bakers-build/core/plugins` barrel.
    ['@bakers-build/addon-remote-drupal', ['remotes']],
    ['@bakers-build/addon-workspace-git', ['workspaces']],
    ['@bakers-build/addon-herdr', ['executors', 'workspaces']],
    ['@bakers-build/addon-claude', ['agents']],
    ['@bakers-build/addon-codex', ['agents']],
    ['@bakers-build/addon-kimi', ['agents']],
    ['@bakers-build/addon-opencode', ['agents']],
  ] as const;

  for (const [pkg, keys] of conductorAddons) {
    it(`${pkg} contributes ${keys.join('+')} (conductor surface)`, async () => {
      const out = await discoverAddons([pkg], 'conductor', bases);
      for (const key of keys) {
        expect(out[key].length, `${pkg} → ${key}`).toBeGreaterThan(0);
      }
    });
  }

  it('auth-basic contributes a connection plugin when given a basic token', async () => {
    // BB-224: the connection half of the deleted `@bakers-build/core/builtins`
    // preset. It contributes nothing without a token (by design) and the
    // basicAuthProvider with one.
    const none = await discoverAddons(
      ['@bakers-build/addon-auth-basic'],
      'connection',
      bases,
    );
    expect(none.connectionPlugins).toHaveLength(0);
    const withToken = await discoverAddons(
      [{ use: '@bakers-build/addon-auth-basic', with: { basic: 'dG9rZW4=' } }],
      'connection',
      bases,
    );
    expect(withToken.connectionPlugins.map((p) => p?.id)).toEqual([
      'bakers-basic-auth',
    ]);
  });

  it('the fake fixture contributes a remote too (folded in from core)', async () => {
    const fakeBase = pathToFileURL(
      join(import.meta.dirname, '..', '..', 'addons', 'fake', 'package.json'),
    ).href;
    const out = await discoverAddons(
      ['@bakers-build/addon-fake'],
      'conductor',
      [fakeBase],
    );
    expect(out.remotes.length).toBeGreaterThan(0);
  });

  it('essentials + bakers-ui contribute connection plugins', async () => {
    const essentials = await discoverAddons(
      ['@bakers-build/addon-essentials'],
      'connection',
      bases,
    );
    expect(essentials.connectionPlugins.length).toBeGreaterThan(0);
    const ui = await discoverAddons(
      ['@bakers-build/addon-bakers-ui'],
      'connection',
      bases,
    );
    expect(ui.connectionPlugins.length).toBeGreaterThan(0);
  });

  // BB-373 AC-5 — BOTH directions, and the cheapest possible statement of the
  // property: listing the addon puts its entry in `uiEntries`, unlisting it
  // leaves the list empty. What travels is the SPECIFIER of the entry module,
  // never a constructed contribution — this suite is the one that measured F2's
  // 5 s timeout, so a regression to eager UI imports fails right here.
  it('collects uiEntries from a listed addon, and nothing when unlisted (AC-5)', async () => {
    const withAddon = await discoverAddons(
      ['@bakers-build/addon-bakers-ui-artifacts'],
      'connection',
      bases,
    );
    expect(withAddon.uiEntries).toEqual([
      '@bakers-build/addon-bakers-ui-artifacts/ui',
    ]);

    const without = await discoverAddons([], 'connection', bases);
    expect(without.uiEntries).toEqual([]);
  });

  // The other half of F2: an addon on the connection surface that contributes
  // NO UI entry stays empty, so `bakers dropsh` pays nothing for this mechanism.
  it('leaves uiEntries empty for a connection addon that contributes none', async () => {
    const essentials = await discoverAddons(
      ['@bakers-build/addon-essentials'],
      'connection',
      bases,
    );
    expect(essentials.uiEntries).toEqual([]);
  });

  it('ui + dropsh + conductor contribute command descriptors', async () => {
    const cmds = await discoverAddons(
      [
        '@bakers-build/conductor',
        '@bakers-build/ui',
        '@bakers-build/addon-dropsh',
      ],
      'command',
      bases,
    );
    expect(cmds.commands.map((c) => c.name)).toEqual([
      'oven',
      'ui',
      'dropsh',
      'tools',
      'auth',
    ]);
    // each descriptor carries a describe (for --help stubs)
    expect(cmds.commands.every((c) => c.describe.length > 0)).toBe(true);
  });

  it('the fake fixture contributes executor + workspace via its preset', async () => {
    // fake is workspace-only (never published) → resolve from its own dir.
    const fakeBase = pathToFileURL(
      join(import.meta.dirname, '..', '..', 'addons', 'fake', 'package.json'),
    ).href;
    const out = await discoverAddons(
      ['@bakers-build/addon-fake'],
      'conductor',
      [fakeBase],
    );
    expect(out.executors.length).toBeGreaterThan(0);
    expect(out.workspaces.length).toBeGreaterThan(0);
  });

  it('emptyContributions is the zero value', () => {
    const z = emptyContributions();
    expect(z.commands).toEqual([]);
    expect(z.executors).toEqual([]);
    expect(z.processHosts).toEqual([]);
  });
});
