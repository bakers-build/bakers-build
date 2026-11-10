import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPortsTransport,
  PORTS_NEEDS_ENTRY,
  portsSettings,
} from '../src/config.js';
import {
  assertPortsTransport,
  InvalidTransportModuleError,
} from '../src/transport.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bakers-ports-transport-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeModule(name: string, source: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, 'utf8');
  return path;
}

describe('assertPortsTransport', () => {
  it('accepts a well-formed transport', () => {
    expect(() =>
      assertPortsTransport(
        {
          id: 'x',
          identity: 'id',
          validateData: () => {},
          reconcile: async () => ({ records: [], ok: true }),
        },
        'spec',
      ),
    ).not.toThrow();
  });

  it('rejects a missing reconcile with a safe diagnostic, not a crash', () => {
    expect(() =>
      assertPortsTransport(
        { id: 'x', identity: 'id', validateData: () => {} },
        'spec',
      ),
    ).toThrow(InvalidTransportModuleError);
  });

  it('rejects a non-object', () => {
    expect(() => assertPortsTransport(null, 'spec')).toThrow(
      InvalidTransportModuleError,
    );
    expect(() => assertPortsTransport('nope', 'spec')).toThrow(
      InvalidTransportModuleError,
    );
  });
});

describe('loadPortsTransport', () => {
  it('fails on a missing package with no state mutation attempted', async () => {
    await expect(
      loadPortsTransport(
        { transport: { use: '@bakers-build/this-does-not-exist' } },
        dir,
      ),
    ).rejects.toThrow(/cannot resolve transport package/);
  });

  it('refuses without a ports addon entry', async () => {
    await expect(loadPortsTransport(undefined, dir)).rejects.toThrow(
      "bakers ports needs '@bakers-build/addon-ports' in addons[] of ~/.bakers/machine.config.js or .bakers/project.config.js, with with.transport.use naming a transport package; see docs/addons/ports",
    );
    await expect(loadPortsTransport({}, dir)).rejects.toThrow(
      PORTS_NEEDS_ENTRY,
    );
  });

  it('rejects a module with no default export factory', async () => {
    const path = await writeModule('no-default.mjs', 'export const foo = 1;\n');
    await expect(
      loadPortsTransport({ transport: { use: path } }, dir),
    ).rejects.toThrow(InvalidTransportModuleError);
  });

  it('rejects a factory whose result is missing required members', async () => {
    const path = await writeModule(
      'malformed.mjs',
      'export default async function () { return { id: "x" }; }\n',
    );
    await expect(
      loadPortsTransport({ transport: { use: path } }, dir),
    ).rejects.toThrow(InvalidTransportModuleError);
  });

  it('loads a well-formed transport and passes settings through', async () => {
    const path = await writeModule(
      'good.mjs',
      [
        'export default async function create(settings, ctx) {',
        '  return {',
        '    id: "good",',
        '    identity: settings.identity,',
        '    zone: ctx.home,',
        '    validateData() {},',
        '    async reconcile(records) { return { records, ok: true }; },',
        '  };',
        '}',
      ].join('\n'),
    );
    const transport = await loadPortsTransport(
      { transport: { use: path, with: { identity: 'abc' } } },
      dir,
    );
    expect(transport.id).toBe('good');
    expect(transport.identity).toBe('abc');
    expect(transport.zone).toBe(dir);
  });

  it('rejects a factory that throws on bad settings with a safe diagnostic', async () => {
    const path = await writeModule(
      'picky.mjs',
      [
        'export default async function create(settings) {',
        '  if (!settings || !settings.ok) throw new Error("bad settings");',
        '  return { id: "picky", identity: "x", validateData(){}, async reconcile(r){ return { records: r, ok: true }; } };',
        '}',
      ].join('\n'),
    );
    await expect(
      loadPortsTransport({ transport: { use: path } }, dir),
    ).rejects.toThrow(/rejected its settings/);
  });

  // BB-681 Task 5: resolved purely by PACKAGE NAME (through `home`'s own
  // `node_modules`), not a file path — proving no built-in switch/if-chain is
  // required anywhere in the loader: a third-party package implementing the
  // same `PortsTransport` export works exactly like a built-in one.
  it('loads a third-party transport resolved by package name through node_modules, not a file path', async () => {
    await writeModule(
      join('node_modules', 'fake-custom-transport', 'package.json'),
      JSON.stringify({
        name: 'fake-custom-transport',
        version: '1.0.0',
        type: 'module',
        main: 'index.mjs',
      }),
    );
    await writeModule(
      join('node_modules', 'fake-custom-transport', 'index.mjs'),
      [
        'export default async function create(settings) {',
        '  return {',
        '    id: "fake-custom-transport",',
        '    identity: "fake-custom-transport",',
        '    validateData() {},',
        '    async reconcile(records) { return { records, ok: true }; },',
        '  };',
        '}',
      ].join('\n'),
    );
    const transport = await loadPortsTransport(
      { transport: { use: 'fake-custom-transport' } },
      dir,
    );
    expect(transport.id).toBe('fake-custom-transport');
  });

  // BB-681 review C1: the global `bakers` install is a symlink
  // (`~/.nvm/.../bin/bakers` → `lib/node_modules/@bakers-build/bakers/bin/bakers`); a
  // built-in transport package lives next to the REAL file, not the symlink's
  // directory, so the host base must be realpath'd before node_modules lookup.
  it('resolves a built-in transport through a symlinked bakers entry point', async () => {
    const realEntry = await writeModule(
      'real/bin/bakers-entry.mjs',
      '// entry\n',
    );
    await writeModule(
      join(
        'real',
        'bin',
        'node_modules',
        'fake-symlinked-transport',
        'package.json',
      ),
      JSON.stringify({
        name: 'fake-symlinked-transport',
        version: '1.0.0',
        type: 'module',
        main: 'index.mjs',
      }),
    );
    await writeModule(
      join(
        'real',
        'bin',
        'node_modules',
        'fake-symlinked-transport',
        'index.mjs',
      ),
      [
        'export default async function create() {',
        '  return {',
        '    id: "fake-symlinked-transport",',
        '    identity: "fake-symlinked-transport",',
        '    validateData() {},',
        '    async reconcile(records) { return { records, ok: true }; },',
        '  };',
        '}',
      ].join('\n'),
    );
    const linkDir = join(dir, 'link');
    await mkdir(linkDir, { recursive: true });
    const linkedEntry = join(linkDir, 'bakers');
    await symlink(realEntry, linkedEntry);

    const emptyHome = join(dir, 'empty-home');
    await mkdir(emptyHome, { recursive: true });

    const originalArgv1 = process.argv[1];
    process.argv[1] = linkedEntry;
    try {
      const transport = await loadPortsTransport(
        { transport: { use: 'fake-symlinked-transport' } },
        emptyHome,
      );
      expect(transport.id).toBe('fake-symlinked-transport');
    } finally {
      process.argv[1] = originalArgv1;
    }
  });

  // BB-681 review N6: the repo's own dev/test-workspace launcher
  // (`bakers-cli/bin/bakers`) is a SEPARATE package from the host and imports
  // `../host/dist/src/host.js` directly — the built-in transport packages
  // live next to THAT sibling, not next to the launcher script itself.
  it('resolves a built-in transport through the dev-launcher sibling host layout', async () => {
    const launcherEntry = await writeModule('repo/bin/bakers', '// launcher\n');
    await writeModule(
      join(
        'repo',
        'host',
        'node_modules',
        'fake-launcher-transport',
        'package.json',
      ),
      JSON.stringify({
        name: 'fake-launcher-transport',
        version: '1.0.0',
        type: 'module',
        main: 'index.mjs',
      }),
    );
    await writeModule(
      join(
        'repo',
        'host',
        'node_modules',
        'fake-launcher-transport',
        'index.mjs',
      ),
      [
        'export default async function create() {',
        '  return {',
        '    id: "fake-launcher-transport",',
        '    identity: "fake-launcher-transport",',
        '    validateData() {},',
        '    async reconcile(records) { return { records, ok: true }; },',
        '  };',
        '}',
      ].join('\n'),
    );

    const emptyHome = join(dir, 'empty-home-launcher');
    await mkdir(emptyHome, { recursive: true });

    const originalArgv1 = process.argv[1];
    process.argv[1] = launcherEntry;
    try {
      const transport = await loadPortsTransport(
        { transport: { use: 'fake-launcher-transport' } },
        emptyHome,
      );
      expect(transport.id).toBe('fake-launcher-transport');
    } finally {
      process.argv[1] = originalArgv1;
    }
  });
});

describe('portsSettings', () => {
  const ENTRY = '@bakers-build/addon-ports';
  let bakersHome: string;
  let worktree: string;

  beforeEach(async () => {
    bakersHome = join(dir, 'bakers-home');
    worktree = join(dir, 'project');
    await mkdir(bakersHome, { recursive: true });
    await mkdir(join(worktree, '.bakers'), { recursive: true });
    vi.stubEnv('BAKERS_HOME', bakersHome);
  });
  afterEach(() => vi.unstubAllEnvs());

  const machine = (body: string) =>
    writeFile(
      join(bakersHome, 'machine.config.js'),
      `export default { machine_id: 'm1', label: 'test', ...${body} };`,
    );
  const project = (body: string) =>
    writeFile(
      join(worktree, '.bakers', 'project.config.js'),
      `export default { project: { name: 'demo' }, ...${body} };`,
    );

  it('uses the machine transport over the project one', async () => {
    await machine(
      `{ addons: [{ use: '${ENTRY}', with: { transport: { use: 'machine-t' } } }] }`,
    );
    await project(
      `{ addons: [{ use: '${ENTRY}', with: { transport: { use: 'project-t' } } }] }`,
    );
    expect(await portsSettings(worktree)).toEqual({
      transport: { use: 'machine-t' },
    });
  });

  it('uses a project transport when the machine sets none', async () => {
    await machine(`{ addons: ['${ENTRY}'] }`);
    await project(
      `{ addons: [{ use: '${ENTRY}', with: { transport: { use: 'project-t' } } }] }`,
    );
    expect(await portsSettings(worktree)).toEqual({
      transport: { use: 'project-t' },
    });
  });

  it('has no settings without a ports addon entry', async () => {
    await machine('{}');
    expect(await portsSettings(worktree)).toBeUndefined();
  });

  it('machine transport-only with keeps project services', async () => {
    await machine(
      `{ addons: [{ use: '${ENTRY}', with: { transport: { use: 'machine-t' } } }] }`,
    );
    await project(
      `{ addons: [{ use: '${ENTRY}', with: { services: [{ key: 'docs', match: 'vitepress' }] } }] }`,
    );
    expect(await portsSettings(worktree)).toEqual({
      transport: { use: 'machine-t' },
      services: [{ key: 'docs', match: 'vitepress' }],
    });
  });

  it('throws naming the file and key for a malformed project entry', async () => {
    await machine('{}');
    await project(
      `{ addons: [{ use: '${ENTRY}', with: { services: [{ key: 'docs', match: 'a' }, { key: 'docs', match: 'b' }] } }] }`,
    );
    await expect(portsSettings(worktree)).rejects.toThrow(
      `${join(worktree, '.bakers', 'project.config.js')}: addons[${ENTRY}].with.services[1].key duplicates 'docs'`,
    );
  });

  // BAKERS-159: the machine schema refuses the retired key at load, naming
  // the file and its addons[] replacement.
  it('machine ports key throws the retired-key remediation', async () => {
    await machine(`{ ports: { transport: { use: 'old-t' } } }`);
    await expect(portsSettings(worktree)).rejects.toThrow(
      `${join(bakersHome, 'machine.config.js')}: ports is retired: configure it as addons: [{ use: '@bakers-build/addon-ports', with: … }]`,
    );
  });
});
