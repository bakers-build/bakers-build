import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveBbConfigPath } from '../../src/cli/bakers-dir.js';
import type { BbCommandHost } from '../../src/cli/commands.js';
import {
  BbConnectionConfigError,
  loadBbConfig,
  loadBbConnectionBootstrap,
  reportLoadedBbConfigFields,
} from '../../src/cli/load-bakers-config.js';

const host: BbCommandHost = { resolveBases: [import.meta.url] };

describe('loadBbConfig — connection loader (site + plugins only)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-load-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const bakersDir = () => {
    const d = join(tmp, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };

  it('reports a computed effective prefix and empty plugin list', async () => {
    const path = join(bakersDir(), 'connection.config.js');
    writeFileSync(
      path,
      `const prefix = '/custom'; export default { site: { base_url: 'https://x.test', jsonapi_prefix: prefix }, plugins: [] };`,
    );
    await expect(reportLoadedBbConfigFields(path)).resolves.toEqual(
      expect.arrayContaining([
        {
          key: 'site.jsonapi_prefix',
          value: '/custom',
          source: 'dynamic/not statically determined',
        },
        { key: 'plugins', value: [], source: path },
      ]),
    );
  });
  it('reports computed plugin options and redacts credential fields', async () => {
    const path = join(bakersDir(), 'connection.config.js');
    writeFileSync(
      path,
      `const option = 'chosen'; export default { site: { base_url: 'https://x.test' }, plugins: [{ plugin: 'example', with: { option, client_id: 'private-id', client_secret: 'private-secret' } }] };`,
    );
    const fields = await reportLoadedBbConfigFields(path);
    expect(fields).toContainEqual({
      key: 'plugins[0].with.option',
      value: 'chosen',
      source: 'dynamic/not statically determined',
    });
    expect(fields).toContainEqual({
      key: 'plugins[0].with.client_secret',
      value: '[REDACTED]',
      source: path,
    });
    expect(fields).toContainEqual({
      key: 'site.jsonapi_prefix',
      value: '/jsonapi',
      source: 'built-in default',
    });
    expect(JSON.stringify(fields)).not.toContain('private-secret');
    expect(JSON.stringify(fields)).not.toContain('private-id');
  });

  it('refuses a connection at an unknown schema version, naming bakers init', async () => {
    writeFileSync(
      join(bakersDir(), 'connection.config.js'),
      `// @bakers-schema-version 4\nexport default { schema_version: 4, site: { base_url: 'https://x.test' }, plugins: [] };`,
    );
    await expect(loadBbConfig(host, { cwd: tmp })).rejects.toThrow(
      /bakers init/,
    );
  });

  it('refuses a connection at schema version 1, naming bakers config upgrade', async () => {
    writeFileSync(
      join(bakersDir(), 'connection.config.js'),
      `// @bakers-schema-version 1\nexport default { schema_version: 1, site: { base_url: 'https://x.test' }, plugins: [] };`,
    );
    await expect(loadBbConfig(host, { cwd: tmp })).rejects.toThrow(
      'schema version 1 is not supported; run bakers config upgrade to rewrite it at version 2',
    );
  });

  it('refuses an old project bakers.config.js, naming connection.config.js', async () => {
    writeFileSync(
      join(bakersDir(), 'bakers.config.js'),
      `export default { site: { base_url: 'https://x.test' }, plugins: [] };`,
    );
    await expect(loadBbConfig(host, { cwd: tmp })).rejects.toThrow(
      'bakers.config.js was renamed: use connection.config.js',
    );
  });

  it('reads site + already-constructed plugins from a project connection.config.js', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
        plugins: [{ id: 'session' }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.site.base_url).toBe('https://x.test');
    expect(cfg.site.jsonapi_prefix).toBe('/jsonapi');
    expect(cfg.plugins).toHaveLength(1);
    expect(cfg.fallback).toBe(false);
    expect(cfg.config_path).toBe(join(d, 'connection.config.js'));
  });

  it('lets a caller clear a legacy global workspace for accessible project lookup', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, workspace_id: 'legacy-workspace', plugins: [] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, {
      cwd: tmp,
      workspaceIdOverride: '',
    });
    expect(cfg.workspace_id).toBeUndefined();
  });

  it('resolves a `{ plugin }` descriptor via the config dir base', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'myplugin.js'),
      `export default (opts) => ({ id: opts?.id ?? 'md' });\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
        plugins: [{ plugin: './myplugin.js', with: { id: 'markdown' } }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins).toEqual([{ id: 'markdown' }]);
  });

  it('does not load project-file credentials when the canonical connection is absent', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'project.config.js'),
      "export default {site:{base_url:'https://legacy.test'},workspace_id:'old'};",
    );
    await expect(
      loadBbConfig(host, { cwd: tmp, home: join(tmp, 'home') }),
    ).rejects.toThrow('bakers config init --scope connection');
  });

  it('AC-5: prefers connection.config.js over a co-located project.config.js (resolution not legacy)', async () => {
    const d = bakersDir();
    // A project file that carries site + plugins — the sibling
    // connection.config.js must win.
    writeFileSync(
      join(d, 'project.config.js'),
      `export default {
        site: { base_url: 'https://legacy.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
        project: { name: 'demo' },
        states: ['working'],
        plugins: [{ id: 'legacy-session' }],
      };\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://connection.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
        plugins: [{ id: 'session' }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.config_path.endsWith('connection.config.js')).toBe(true);
    expect(cfg.site.base_url).toBe('https://connection.test');
    // The path resolver reports a non-legacy resolution once connection.config.js exists.
    const resolution = resolveBbConfigPath({ cwd: tmp });
    expect(resolution.legacy).toBe(false);
    expect(resolution.path.endsWith('connection.config.js')).toBe(true);
  });

  it('an explicit path wins over walk-up', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://project.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    const explicitDir = join(tmp, 'custom');
    mkdirSync(explicitDir, { recursive: true });
    const explicit = join(explicitDir, 'c.config.js');
    writeFileSync(
      explicit,
      `export default { site: { base_url: 'https://explicit.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp, explicit });
    expect(cfg.site.base_url).toBe('https://explicit.test');
  });

  it('loads a named connection from the bakers.build connections directory', async () => {
    const home = join(tmp, 'home');
    const homeBb = join(home, '.bakers');
    const connections = join(homeBb, 'connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(
      join(homeBb, 'connections', 'default.js'),
      `export default { site: { base_url: 'https://default.test' }, plugins: [] };\n`,
    );
    writeFileSync(
      join(connections, 'staging.js'),
      `export default { site: { base_url: 'https://staging.test' }, plugins: [] };\n`,
    );

    const options = { cwd: tmp, home, connection: 'staging' };
    const cfg = await loadBbConfig(host, options);

    expect(cfg.site.base_url).toBe('https://staging.test');
    expect(cfg.config_path).toBe(join(connections, 'staging.js'));
    expect(cfg.connection_id).toBe('staging');
    expect(cfg.selection_source).toBe('flag-connection');
  });

  it('--config beats --connection', async () => {
    const home = join(tmp, 'home');
    const connections = join(home, '.bakers/connections');
    mkdirSync(connections, { recursive: true });
    const explicit = join(tmp, 'explicit.js');
    writeFileSync(
      explicit,
      `export default { site: { base_url: 'https://explicit.test' }, plugins: [] };\n`,
    );
    writeFileSync(
      join(connections, 'staging.js'),
      `export default { site: { base_url: 'https://staging.test' }, plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, {
      cwd: tmp,
      home,
      explicit,
      connection: 'staging',
      env: {},
    });
    expect(cfg.site.base_url).toBe('https://explicit.test');
    expect(cfg.selection_source).toBe('flag-config');
  });

  // BAKERS-159: the checkout selection file `.bakers/connection.config.local.js`
  // is retired; BAKERS_CONNECTION / --connection select a connection. A
  // checkout still holding the file is refused with that replacement.
  it('refuses a retired connection.config.local.js, naming BAKERS_CONNECTION', async () => {
    const projectBb = bakersDir();
    writeFileSync(
      join(projectBb, 'connection.config.local.js'),
      `export default { connection: 'staging' };\n`,
    );
    const home = join(tmp, 'home');
    const connections = join(home, '.bakers', 'connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(
      join(connections, 'staging.js'),
      `export default { site: { base_url: 'https://staging.test' }, plugins: [] };\n`,
    );
    await expect(
      loadBbConfig(host, { cwd: tmp, home, env: {} }),
    ).rejects.toThrow(
      `${join(projectBb, 'connection.config.local.js')} was renamed: use BAKERS_CONNECTION or --connection; the file is retired`,
    );
  });

  it('--connection beats BAKERS_CONNECTION', async () => {
    const home = join(tmp, 'home');
    const connections = join(home, '.bakers/connections');
    mkdirSync(connections, { recursive: true });
    for (const id of ['flag', 'environment'])
      writeFileSync(
        join(connections, `${id}.js`),
        `export default { site: { base_url: 'https://${id}.test' }, plugins: [] };\n`,
      );
    const byFlag = await loadBbConfig(host, {
      cwd: tmp,
      home,
      connection: 'flag',
      env: { BAKERS_CONNECTION: 'environment' },
    });
    expect(byFlag.site.base_url).toBe('https://flag.test');
    const byEnv = await loadBbConfig(host, {
      cwd: tmp,
      home,
      env: { BAKERS_CONNECTION: 'environment' },
    });
    expect(byEnv.site.base_url).toBe('https://environment.test');
  });

  it('uses the implicit default global connection when no selector exists', async () => {
    const home = join(tmp, 'home');
    const homeBb = join(home, '.bakers');
    mkdirSync(join(homeBb, 'connections'), { recursive: true });
    writeFileSync(
      join(homeBb, 'connections', 'default.js'),
      `export default { site: { base_url: 'https://default.test' }, plugins: [] };\n`,
    );
    writeFileSync(
      join(homeBb, 'connections/only.js'),
      `export default { site: { base_url: 'https://only.test' }, plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp, home, env: {} });
    expect(cfg.site.base_url).toBe('https://default.test');
    expect(cfg.connection_id).toBe('default');
    expect(cfg.selection_source).toBe('default');
  });

  it('uses a sole named connection when the default global connection is absent', async () => {
    const home = join(tmp, 'home');
    const connections = join(home, '.bakers/connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(
      join(connections, 'only.js'),
      `export default { site: { base_url: 'https://only.test' }, plugins: [] };\n`,
    );

    const cfg = await loadBbConfig(host, { cwd: tmp, home, env: {} });
    expect(cfg.site.base_url).toBe('https://only.test');
    expect(cfg.connection_id).toBe('only');
    expect(cfg.selection_source).toBe('sole-connection');
  });

  it("passes unknown named connections through dropsh's actionable error", async () => {
    const home = join(tmp, 'home');
    const connections = join(home, '.bakers/connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(join(connections, 'available.js'), 'export default {};\n');
    await expect(
      loadBbConfig(host, {
        cwd: tmp,
        home,
        connection: 'missing',
        env: {},
      }),
    ).rejects.toThrow(/missing.*available.*connections/is);
  });

  it('loads the connection selected by BAKERS_CONNECTION', async () => {
    const home = join(tmp, 'home');
    const homeBb = join(home, '.bakers');
    const connections = join(homeBb, 'connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(
      join(homeBb, 'connections', 'default.js'),
      `export default { site: { base_url: 'https://default.test' }, plugins: [] };\n`,
    );
    writeFileSync(
      join(connections, 'staging.js'),
      `export default { site: { base_url: 'https://staging.test' }, plugins: [] };\n`,
    );

    const options = {
      cwd: tmp,
      home,
      env: { BAKERS_CONNECTION: 'staging' },
    };
    const cfg = await loadBbConfig(host, options);

    expect(cfg.site.base_url).toBe('https://staging.test');
    expect(cfg.selection_source).toBe('env-connection');
  });

  it('flattens a plugins[] descriptor whose factory returns an array (BB-129)', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'fixture.js'),
      `export const mkPlugin = (o) => ({ id: o?.id ?? 'p' });
export const mkComposite = () => ([{ id: 'child-a' }, { id: 'child-b' }]);\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000',
        plugins: [
          { plugin: './fixture.js', export: 'mkPlugin', with: { id: 'lead' } },
          { plugin: './fixture.js', export: 'mkComposite' },
          { id: 'tail' },
        ],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins.map((p) => (p as { id: string }).id)).toEqual([
      'lead',
      'child-a',
      'child-b',
      'tail',
    ]);
    expect(cfg.plugins.some((p) => Array.isArray(p))).toBe(false);
  });

  // BB-219 (D4): the loader forwards the resolver's `source` + `legacy` onto
  // the connection, so a consumer can report which file won and why WITHOUT
  // re-deriving the precedence (AC-6/AC-7). Additive fields only.
  describe('source + legacy are forwarded onto the connection (BB-219 D4)', () => {
    it('forwards source `project` for a config found by walk-up', async () => {
      const d = bakersDir();
      writeFileSync(
        join(d, 'connection.config.js'),
        `export default { site: { base_url: 'https://x.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
      );
      const sub = join(tmp, 'a', 'b');
      mkdirSync(sub, { recursive: true });
      const cfg = await loadBbConfig(host, { cwd: sub });
      expect(cfg.source).toBe('project');
      expect(cfg.legacy).toBe(false);
      expect(cfg.config_path).toBe(join(d, 'connection.config.js'));
    });

    it('forwards source `explicit` for an explicitly named config', async () => {
      const explicit = join(tmp, 'c.config.js');
      writeFileSync(
        explicit,
        `export default { site: { base_url: 'https://e.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
      );
      const cfg = await loadBbConfig(host, { cwd: tmp, explicit });
      expect(cfg.source).toBe('explicit');
    });
  });

  it('throws when site.base_url is missing', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: {}, plugins: [] };\n`,
    );
    await expect(loadBbConfig(host, { cwd: tmp })).rejects.toThrow(
      /site\.base_url/,
    );
  });

  // BB-218 AC-9: an unresolvable connection (empty base_url) fails with a
  // legible error naming the RESOLVED path + the file that should supply it —
  // never a downstream plugin-resolution error (auth is no longer in the engine
  // config, so no plugin construction runs before the base_url check).
  it('AC-9: names the resolved connection path + expected file, not a plugin error', async () => {
    const d = bakersDir();
    const cfg = join(d, 'connection.config.js');
    // Empty base_url AND a plugin descriptor that WOULD throw a plugin error if
    // resolution ran before the base_url guard.
    writeFileSync(
      cfg,
      `export default { site: {}, plugins: [{ plugin: '@does-not-exist/nope' }] };\n`,
    );
    let caught: unknown;
    try {
      await loadBbConfig(host, { cwd: tmp });
    } catch (e) {
      caught = e;
    }
    const message = (caught as Error).message;
    expect(message).toContain('site.base_url');
    expect(message).toContain(cfg);
    expect(message).toMatch(/connection\.config\.js/);
    // NOT the plugin-resolution error.
    expect(message).not.toMatch(/cannot resolve plugin/);
    expect(message).not.toContain('@does-not-exist/nope');
  });

  it('surfaces the original importConfig failure instead of discarding it (BB-470)', async () => {
    const d = bakersDir();
    writeFileSync(join(d, 'connection.config.js'), 'export default = {;\n');
    const err = await loadBbConfig(host, { cwd: tmp }).catch((e) => e);
    expect(err).toBeInstanceOf(BbConnectionConfigError);
    expect((err as Error).message).toMatch(/check its syntax/);
    expect((err as Error).message).not.toBe(
      `Could not import connection ${join(d, 'connection.config.js')}; check its syntax and imported files with bakers config check --scope connection --config ${join(d, 'connection.config.js')}.`,
    );
    expect((err as { cause?: unknown }).cause).toBeDefined();
  });

  // BB-230 (RED, root cause 2) end to end: the exact second hard failure from
  // the ticket's reproducible condition. A repo whose `.bakers/` holds only the
  // engine-only `project.config.js` must LOAD its connection from the home
  // `~/.bakers/connections/default.js`, not die on
  // `bakers connection config requires site.base_url — resolved …/project.config.js`.
  it('AC-6/AC-12: an engine-only project.config.js loads the HOME connection', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'project.config.js'),
      `export default {
        schema_version: 2,
        project: { name: 'p' },
        server: { use: '@bakers-build/addon-remote-drupal' },
      };\n`,
    );
    const fakeHome = mkdtempSync(join(tmpdir(), 'bb-230-home-'));
    const homeBb = join(fakeHome, '.bakers');
    mkdirSync(join(homeBb, 'connections'), { recursive: true });
    writeFileSync(
      join(homeBb, 'connections', 'default.js'),
      `export default { site: { base_url: 'https://home.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    try {
      const cfg = await loadBbConfig(host, { cwd: tmp, home: fakeHome });
      expect(cfg.site.base_url).toBe('https://home.test');
      expect(cfg.config_path).toBe(join(homeBb, 'connections', 'default.js'));
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('loadBbConfig — workspace_id is optional (BB-495)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-ws-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const bakersDir = () => {
    const d = join(tmp, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };

  const WS = '11111111-2222-3333-4444-555555555555';

  it('loads a connection that names no workspace', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.workspace_id).toBeUndefined();
    expect(cfg.site.base_url).toBe('https://x.test');
  });

  it('treats a blank workspace_id the same as none, rather than a half-configured connection', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, workspace_id: '   ', plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.workspace_id).toBeUndefined();
  });

  // BAKERS-159: the connection schema types workspace_id as a string, so a
  // non-string is refused naming the key instead of being read as none.
  it('refuses a non-string workspace_id, naming the key', async () => {
    const d = bakersDir();
    for (const bad of ['null', '42']) {
      writeFileSync(
        join(d, 'connection.config.js'),
        `export default { site: { base_url: 'https://x.test' }, workspace_id: ${bad}, plugins: [] };\n`,
      );
      await expect(loadBbConfig(host, { cwd: tmp })).rejects.toThrow(
        /workspace_id/,
      );
    }
  });
  it('forwards the trimmed uuid onto the resolved connection', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, workspace_id: '  ${WS}  ', plugins: [] };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.workspace_id).toBe(WS);
  });

  it('hands it to a legacy `plugins[]` descriptor as its options (the essentials path)', async () => {
    const d = bakersDir();
    // Stands in for `@bakers-build/addon-essentials`: a descriptor with NO `with`,
    // which is exactly how every config names the aggregator.
    writeFileSync(
      join(d, 'aggregator.js'),
      `export default (opts) => ({ id: 'agg', seen: opts?.workspace_id });\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        plugins: [{ plugin: './aggregator.js' }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins).toEqual([{ id: 'agg', seen: WS }]);
  });

  // BB-472: `bakers ui --workspace <name|uuid>` overrides the configured
  // workspace for THIS process only — a one-shot override, never persisted.
  // It works by re-running the SAME plugin construction with a different
  // global, rather than by editing the config file.
  it('workspaceIdOverride replaces the file value in the globals every plugin sees, without persisting it', async () => {
    const OVERRIDE = '99999999-9999-4999-8999-999999999999';
    const d = bakersDir();
    writeFileSync(
      join(d, 'aggregator.js'),
      `export default (opts) => ({ id: 'agg', seen: opts?.workspace_id });\n`,
    );
    const configPath = join(d, 'connection.config.js');
    writeFileSync(
      configPath,
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        plugins: [{ plugin: './aggregator.js' }],
      };\n`,
    );
    const before = readFileSync(configPath, 'utf8');
    const cfg = await loadBbConfig(host, {
      cwd: tmp,
      workspaceIdOverride: OVERRIDE,
    });
    expect(cfg.workspace_id).toBe(OVERRIDE);
    expect(cfg.plugins).toEqual([{ id: 'agg', seen: OVERRIDE }]);
    // Never written to disk.
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('hands it to an `addons[]` preset as its options', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'node_modules-preset.js'),
      `export const connectionPlugins = (acc, opts) => [...acc, { id: 'p', seen: opts?.workspace_id }];\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        addons: ['./node_modules-preset.js'],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins).toEqual([{ id: 'p', seen: WS }]);
  });

  it("an entry's own `with` overrides the global, key by key", async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'p.js'),
      `export default (opts) => ({ id: 'p', seen: opts?.workspace_id, extra: opts?.extra });\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        plugins: [{ plugin: './p.js', with: { workspace_id: 'explicit-wins', extra: 1 } }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins).toEqual([{ id: 'p', seen: 'explicit-wins', extra: 1 }]);
  });

  it('leaves an entry that ignores the extra key untouched', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'auth.js'),
      `export default (opts) => ({ id: opts?.id ?? 'none' });\n`,
    );
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        plugins: [{ plugin: './auth.js', with: { id: 'session' } }],
      };\n`,
    );
    const cfg = await loadBbConfig(host, { cwd: tmp });
    expect(cfg.plugins).toEqual([{ id: 'session' }]);
  });
});

// BB-495 F1: a `workspace_id` with no plugin that applies it used to warn
// on every load — including a standard `bakers ui` config, where the plugin is
// attached by the caller right after this function returns, and a standard
// `bakers dropsh` config, where D1 forbids attaching one at all. The warning
// had no config that could act on it, so it is gone rather than re-scoped.
describe('loadBbConfig — a workspace with no plugin that applies it (BB-495 F1)', () => {
  const WS = '33333333-4444-5555-6666-777777777777';
  let tmp: string;
  let warnings: string[];
  let restoreWarn: () => void;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-load-warn-'));
    warnings = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    restoreWarn = () => {
      console.warn = original;
    };
  });
  afterEach(() => {
    restoreWarn();
    rmSync(tmp, { recursive: true, force: true });
  });

  const bakersDir = () => {
    const d = join(tmp, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };

  it('never warns, whether or not a bakers-workspace plugin is present', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default {
        site: { base_url: 'https://x.test' },
        workspace_id: '${WS}',
        plugins: [],
      };\n`,
    );
    await loadBbConfig(host, { cwd: tmp });
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when no workspace is configured', async () => {
    const d = bakersDir();
    writeFileSync(
      join(d, 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, workspace_id: '', plugins: [] };\n`,
    );
    await loadBbConnectionBootstrap(host, { cwd: tmp });
    expect(warnings).toHaveLength(0);
  });
});

describe('loadBbConnectionBootstrap — layered UI entries', () => {
  let tmp: string;
  let home: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-uilayers-'));
    home = join(tmp, 'home');
    mkdirSync(join(home, '.bakers'), { recursive: true });
    mkdirSync(join(tmp, '.bakers'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const tabAddon = (dir: string, name: string, entry: string) => {
    writeFileSync(
      join(dir, `${name}.js`),
      `export const uiEntries = (acc) => [...acc, './${entry}'];`,
    );
    writeFileSync(join(dir, entry), 'export default {};');
  };

  const connection = (addons: string) =>
    writeFileSync(
      join(tmp, '.bakers', 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' }, addons: ${addons} };`,
    );

  it('concatenates machine, connection and project layers in that order', async () => {
    tabAddon(join(home, '.bakers'), 'm', 'm-tab.js');
    tabAddon(join(tmp, '.bakers'), 'c', 'c-tab.js');
    tabAddon(join(tmp, '.bakers'), 'p', 'p-tab.js');
    writeFileSync(
      join(home, '.bakers', 'machine.config.js'),
      `export default { machine_id: 'h', label: 'h', addons: ['./m.js'] };`,
    );
    connection(`['./c.js']`);
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./p.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, { cwd: tmp, home });
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual([
      'm-tab.js',
      'c-tab.js',
      'p-tab.js',
    ]);
  });

  it('deduplicates on the resolved file, not the specifier string', async () => {
    // The two layers name the SAME module through two DIFFERENT specifier
    // strings, each resolving through that layer's own bases to the identical
    // absolute file — the one distinction a specifier-string `seen` set cannot
    // make. Machine resolves './shared-tab.js' directly against `sharedDir`
    // (present in its bases); project resolves '../shared/shared-tab.js'
    // against its own `.bakers` dir, landing on the same file by a different
    // relative route.
    const sharedDir = join(tmp, 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, 'shared-tab.js'), 'export default {};');
    const sharedHost: BbCommandHost = {
      resolveBases: [pathToFileURL(`${sharedDir}/`).href, ...host.resolveBases],
    };
    writeFileSync(
      join(home, '.bakers', 'm.js'),
      `export const uiEntries = (acc) => [...acc, './shared-tab.js'];`,
    );
    writeFileSync(
      join(tmp, '.bakers', 'p.js'),
      `export const uiEntries = (acc) => [...acc, '../shared/shared-tab.js'];`,
    );
    tabAddon(join(tmp, '.bakers'), 'c', 'c-tab.js');
    writeFileSync(
      join(home, '.bakers', 'machine.config.js'),
      `export default { machine_id: 'h', label: 'h', addons: ['./m.js'] };`,
    );
    connection(`['./c.js']`);
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./p.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(sharedHost, {
      cwd: tmp,
      home,
    });
    // A single entry: had dedup keyed on the specifier string, the two
    // distinct specifiers above would have produced TWO entries.
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual([
      'shared-tab.js',
      'c-tab.js',
    ]);
  });

  it('does not dedup two different files that share a specifier name', async () => {
    // Converse of the previous case: the SAME specifier string, './tab.js',
    // named in two layers but resolving — each against its own layer-local
    // directory — to two genuinely different files. Specifier-string keying
    // would collapse these; resolved-URL keying must not.
    tabAddon(join(home, '.bakers'), 'tab', 'm-tab.js');
    tabAddon(join(tmp, '.bakers'), 'tab', 'p-tab.js');
    writeFileSync(
      join(home, '.bakers', 'machine.config.js'),
      `export default { machine_id: 'h', label: 'h', addons: ['./tab.js'] };`,
    );
    writeFileSync(
      join(tmp, '.bakers', 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' } };`,
    );
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./tab.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, { cwd: tmp, home });
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual([
      'm-tab.js',
      'p-tab.js',
    ]);
  });

  it('keys the project layer on the SELECTED connection config, not on cwd', async () => {
    // Two trees: `otherProject` carries the connection config that is
    // explicitly selected, `tmp` is merely where the command happens to run.
    // The project layer must come from `otherProject`'s conductor config, not
    // from a conductor config sitting beside `cwd`.
    const otherProject = join(tmp, 'other-project');
    mkdirSync(join(otherProject, '.bakers'), { recursive: true });
    tabAddon(join(otherProject, '.bakers'), 'right', 'right-tab.js');
    writeFileSync(
      join(otherProject, '.bakers', 'connection.config.js'),
      `export default { site: { base_url: 'https://x.test' } };`,
    );
    writeFileSync(
      join(otherProject, '.bakers', 'project.config.js'),
      `export default { addons: ['./right.js'] };`,
    );
    tabAddon(join(tmp, '.bakers'), 'wrong', 'wrong-tab.js');
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./wrong.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, {
      cwd: tmp,
      home,
      explicit: join(otherProject, '.bakers', 'connection.config.js'),
    });
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual([
      'right-tab.js',
    ]);
  });

  it('falls back to cwd for the project layer when the connection is the canonical engine-only shape (home fallback)', async () => {
    // No project `connection.config.js` anywhere: the connection resolves to
    // `<home>/.bakers/connections/default.js` (`resolution.source === 'home'`),
    // BB-218's canonical repo shape — a project carries only its own
    // `project.config.js`. The project layer must still come from `cwd`.
    mkdirSync(join(home, '.bakers', 'connections'), { recursive: true });
    writeFileSync(
      join(home, '.bakers', 'connections', 'default.js'),
      `export default { site: { base_url: 'https://x.test' } };`,
    );
    tabAddon(join(tmp, '.bakers'), 'p', 'p-tab.js');
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./p.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, { cwd: tmp, home });
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual(['p-tab.js']);
  });

  it('falls back to cwd for the project layer when the connection is a named connection', async () => {
    const connections = join(home, '.bakers', 'connections');
    mkdirSync(connections, { recursive: true });
    writeFileSync(
      join(connections, 'staging.js'),
      `export default { site: { base_url: 'https://staging.test' } };`,
    );
    tabAddon(join(tmp, '.bakers'), 'p', 'p-tab.js');
    writeFileSync(
      join(tmp, '.bakers', 'project.config.js'),
      `export default { addons: ['./p.js'] };`,
    );
    const cfg = await loadBbConnectionBootstrap(host, {
      cwd: tmp,
      home,
      connection: 'staging',
    });
    expect(cfg.ui_entries.map((u) => u.split('/').pop())).toEqual(['p-tab.js']);
  });

  it('is unchanged for a connection config that is the only layer', async () => {
    tabAddon(join(tmp, '.bakers'), 'c', 'c-tab.js');
    connection(`['./c.js']`);
    const cfg = await loadBbConnectionBootstrap(host, { cwd: tmp, home });
    expect(cfg.ui_entries).toHaveLength(1);
    expect(cfg.ui_entries[0]).toContain('c-tab.js');
  });

  it('still throws for an unresolvable addon in the CONNECTION layer', async () => {
    connection(`['./absent.js']`);
    await expect(
      loadBbConnectionBootstrap(host, { cwd: tmp, home }),
    ).rejects.toThrow("cannot resolve addon './absent.js'");
  });

  it('skips an unresolvable addon in the machine layer and still loads', async () => {
    writeFileSync(
      join(home, '.bakers', 'machine.config.js'),
      `export default { machine_id: 'h', label: 'h', addons: ['./absent.js'] };`,
    );
    connection(`[]`);
    const cfg = await loadBbConnectionBootstrap(host, { cwd: tmp, home });
    expect(cfg.ui_entries).toEqual([]);
    expect(cfg.site.base_url).toBe('https://x.test');
  });
});
