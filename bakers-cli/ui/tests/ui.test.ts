import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BbCommandHost, BbConnectionConfig } from '@bakers-build/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cmdUi, type RunBbUiOptions } from '../src/ui.js';

// BB-201 (AC-3): `bakers ui` reads its connection scope + the registry and
// delegates to `runBbUi`.
// BB-219: that connection scope is now core's — explicit → project walk-up →
// home → shipped fallback — and the ui owns NO precedence rule of its own.
// All seams are injected here.

/** A stand-in for core's `loadBbConfig` that records what it was asked for. */
function fakeLoader(over: Partial<BbConnectionConfig> = {}): {
  load: (
    host: BbCommandHost,
    opts: { cwd?: string; explicit?: string | undefined },
  ) => Promise<BbConnectionConfig>;
  calls: { cwd?: string; explicit?: string | undefined }[];
} {
  const calls: { cwd?: string; explicit?: string | undefined }[] = [];
  return {
    calls,
    load: async (_host, opts) => {
      calls.push(opts);
      return {
        site: {
          base_url: 'https://bakers.example',
          jsonapi_prefix: '/jsonapi',
        },
        workspace_id: '00000000-0000-4000-8000-000000000000',
        plugins: [],
        config_path: '/resolved/connection.config.js',
        fallback: false,
        source: 'project',
        legacy: false,
        ...over,
      };
    },
  };
}

describe('cmdUi connection resolution (BB-219)', () => {
  const savedUiPlugin = process.env.BB_UI_PLUGIN;
  const savedBbConfig = process.env.BAKERS_CONFIG;
  const savedDropshConfig = process.env.DROPSH_CONFIG;
  let tmp: string;

  /** A temp project tree: `<tmp>/.bakers/<file>` + the real config content. */
  const makeProject = (
    root: string,
    baseUrl: string,
    file = 'connection.config.js',
  ): string => {
    const d = join(root, '.bakers');
    mkdirSync(d, { recursive: true });
    const p = join(d, file);
    writeFileSync(
      p,
      `export default { site: { base_url: '${baseUrl}' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    return p;
  };

  beforeEach(() => {
    delete process.env.BB_UI_PLUGIN;
    delete process.env.BAKERS_CONFIG;
    delete process.env.DROPSH_CONFIG;
    tmp = mkdtempSync(join(tmpdir(), 'bakers-ui-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    for (const [k, v] of [
      ['BB_UI_PLUGIN', savedUiPlugin],
      ['BAKERS_CONFIG', savedBbConfig],
      ['DROPSH_CONFIG', savedDropshConfig],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── AC-1 / AC-2: the project's connection wins, found by walk-up ──────────

  it('AC-1: resolves the project ./.bakers/connection.config.js when started in the project', async () => {
    const cfg = makeProject(tmp, 'https://project.test');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.configPath).toBe(cfg);
    expect(opts?.connection.baseUrl).toBe('https://project.test');
  });

  it('prints an available update before launching the renderer', async () => {
    makeProject(tmp, 'https://project.test');
    const order: string[] = [];
    await cmdUi({
      cwd: tmp,
      updateCheck: async () => {
        order.push('notice');
        return 'Run `bakers update`';
      },
      stdout: (line) => order.push(line),
      runUi: async () => {
        order.push('renderer');
      },
    });
    expect(order).toEqual(['notice', 'Run `bakers update`\n', 'renderer']);
  });

  it('AC-2: resolves the SAME project config from a nested subdirectory', async () => {
    const cfg = makeProject(tmp, 'https://project.test');
    const sub = join(tmp, 'packages', 'ui', 'src');
    mkdirSync(sub, { recursive: true });
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: sub,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.configPath).toBe(cfg);
  });

  // ── AC-3: outside a project, unchanged ────────────────────────────────────

  it('AC-3: outside any project the resolution is delegated with that cwd (home legs are core’s)', async () => {
    const loader = fakeLoader({
      config_path: '/home/cw/.bakers/connection.config.js',
      source: 'home',
    });
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      loadConnection: loader.load,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(loader.calls).toEqual([{ cwd: tmp, explicit: undefined }]);
    expect(opts?.connection.configPath).toBe(
      '/home/cw/.bakers/connection.config.js',
    );
  });

  it('AC-3: the global connection is passed through', async () => {
    const loader = fakeLoader({
      config_path: '/ship/connection.config.js',
      fallback: false,
      source: 'home',
    });
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      loadConnection: loader.load,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.configPath).toBe('/ship/connection.config.js');
  });

  // ── AC-4: explicit wins ───────────────────────────────────────────────────

  it('AC-4: an explicit config beats a reachable project config', async () => {
    makeProject(tmp, 'https://project.test');
    const explicit = join(tmp, 'custom.config.js');
    writeFileSync(
      explicit,
      `export default { site: { base_url: 'https://explicit.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      explicitConfig: explicit,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.configPath).toBe(explicit);
    expect(opts?.connection.baseUrl).toBe('https://explicit.test');
  });

  it('AC-4: $BAKERS_CONFIG supplies the explicit leg when --config is absent', async () => {
    const loader = fakeLoader();
    process.env.BAKERS_CONFIG = '/env/connection.config.js';
    await cmdUi({
      cwd: tmp,
      loadConnection: loader.load,
      runUi: async () => {},
    });
    expect(loader.calls[0]?.explicit).toBe('/env/connection.config.js');
  });

  it('AC-4: $DROPSH_CONFIG is the lowest-priority explicit source', async () => {
    const loader = fakeLoader();
    process.env.DROPSH_CONFIG = '/dropsh/connection.config.js';
    await cmdUi({
      cwd: tmp,
      loadConnection: loader.load,
      runUi: async () => {},
    });
    expect(loader.calls[0]?.explicit).toBe('/dropsh/connection.config.js');
  });

  it('AC-4: --config beats $BAKERS_CONFIG beats $DROPSH_CONFIG', async () => {
    const loader = fakeLoader();
    process.env.BAKERS_CONFIG = '/env/connection.config.js';
    process.env.DROPSH_CONFIG = '/dropsh/connection.config.js';
    await cmdUi({
      cwd: tmp,
      explicitConfig: '/flag/connection.config.js',
      loadConnection: loader.load,
      runUi: async () => {},
    });
    expect(loader.calls[0]?.explicit).toBe('/flag/connection.config.js');

    loader.calls.length = 0;
    await cmdUi({
      cwd: tmp,
      loadConnection: loader.load,
      runUi: async () => {},
    });
    expect(loader.calls[0]?.explicit).toBe('/env/connection.config.js');
  });

  // ── AC-5: legacy conductor.config.js, with no UI-side branch ──────────────

  it('a legacy engine connection does not start the renderer without a current connection', async () => {
    makeProject(tmp, 'https://legacy.test', 'conductor.config.js');
    let rendered = false;
    let error = '';
    const previous = process.exitCode;
    try {
      await cmdUi({
        cwd: tmp,
        workspaceRecovery: { home: join(tmp, 'empty-home') },
        stderr: (s) => (error += s),
        runUi: async () => {
          rendered = true;
        },
      });
      expect(rendered).toBe(false);
      expect(error).toContain('bakers config init --scope connection');
    } finally {
      process.exitCode = previous;
    }
  });

  // ── AC-7: --print-config ──────────────────────────────────────────────────

  it('AC-7: --print-config reports path, source and the fallback flag', async () => {
    const out: string[] = [];
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: (s) => out.push(s),
      loadConnection: fakeLoader({
        config_path: '/ship/connection.config.js',
        fallback: false,
        source: 'home',
        site: { base_url: 'https://prod.test', jsonapi_prefix: '/jsonapi' },
        workspace_id: '00000000-0000-4000-8000-000000000000',
      }).load,
      runUi: async () => {},
    });
    const text = out.join('');
    expect(text).toContain('/ship/connection.config.js');
    expect(text).toMatch(/source:\s+home/);
    expect(text).toMatch(/fallback:\s+no/);
    expect(text).toContain('https://prod.test');
  });

  it('AC-7: --print-config does NOT launch the renderer and leaves exit code 0', async () => {
    const saved = process.exitCode;
    process.exitCode = 0;
    let launched = false;
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: () => {},
      loadConnection: fakeLoader().load,
      runUi: async () => {
        launched = true;
      },
    });
    expect(launched).toBe(false);
    expect(process.exitCode).toBe(0);
    process.exitCode = saved;
  });

  it('AC-7: --print-config reports the non-fallback project case as fallback: no', async () => {
    const out: string[] = [];
    makeProject(tmp, 'https://project.test');
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: (s) => out.push(s),
      runUi: async () => {},
    });
    const text = out.join('');
    expect(text).toMatch(/source:\s+project/);
    expect(text).toMatch(/fallback:\s+no/);
    expect(text).toMatch(/legacy:\s+no/);
    expect(text).toContain('https://project.test');
  });

  // BB-232 review finding F1, third consequence. The report used to carry a
  // `project:` line fed from the local registry; with the registry deleted that
  // line could only ever print `(none)`, because resolving the default project
  // is a control-plane read and this command holds no JSON:API client. So the
  // report names the INPUT it does know — the `.bakers` dir the renderer resolves
  // the project from — and says where the project comes from instead of lying
  // about not having one.
  it('--print-config names the bb_dir the project is resolved from', async () => {
    const out: string[] = [];
    makeProject(tmp, 'https://project.test');
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: (s) => out.push(s),
      runUi: async () => {},
    });
    const text = out.join('');
    expect(text).toMatch(/bb_dir:\s+\S*\.bakers\b/);
    expect(text).toMatch(/project:\s+\(resolved from bb_dir\)/);
  });

  it('--print-config reports an explicit --project verbatim', async () => {
    const out: string[] = [];
    makeProject(tmp, 'https://project.test');
    await cmdUi({
      cwd: tmp,
      project: 'shop',
      printConfig: true,
      stdout: (s) => out.push(s),
      runUi: async () => {},
    });
    expect(out.join('')).toMatch(/project:\s+shop/);
  });

  it('--print-config outside any project reports no bb_dir and no project', async () => {
    const out: string[] = [];
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: (s) => out.push(s),
      loadConnection: fakeLoader().load,
      runUi: async () => {},
    });
    const text = out.join('');
    expect(text).toMatch(/bb_dir:\s+\(none\)/);
    expect(text).toMatch(/project:\s+\(none\)/);
  });

  // ── AC-8: the project's control plane ─────────────────────────────────────

  it('AC-8: the project base_url is the one delegated', async () => {
    makeProject(tmp, 'https://dev2.example');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.baseUrl).toBe('https://dev2.example');
    expect(opts?.connection.baseUrl).not.toBe('https://prod.example');
  });

  // ── AC-9: project-rooted cwd ──────────────────────────────────────────────

  it('AC-9: roots the delegated cwd at the repo root of the project it was started in', async () => {
    makeProject(tmp, 'https://project.test');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      runUi: async (o) => {
        opts = o;
      },
    });
    // NOT the registry default (/repos/bakers/.bakers), and not the .bakers dir.
    expect(opts?.cwd).toBe(tmp);
  });

  // BB-232 review finding F1. `bakersDir` was passed and never read: the entry
  // handed it over, the launcher's options type did not know the key, and the
  // two values the deleted registry used to supply became `undefined` in every
  // repo. The renderer is resolved dynamically and the call is cast, so
  // TypeScript could not catch it — this assertion is what does. Its other half
  // (the value reaching the kernel) is
  // `addons/bakers-ui/tests/plugin-own-conductor.test.ts`.
  it('F1: hands the renderer the .bakers dir it resolves the project from', async () => {
    makeProject(tmp, 'https://project.test');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.bakersDir).toBe(join(tmp, '.bakers'));
  });

  it('AC-9: outside any project the agents root at home, claiming no project', async () => {
    // The registry used to supply a "default project" here, taken from the
    // first entry of a file that could name a checkout deleted months ago.
    // With the registry gone the honest answer outside a project is: root at
    // home, claim nothing, and let the Conductors screen list what is real.
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      loadConnection: fakeLoader().load,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.cwd).toBe(homedir());
    expect(opts?.bakersDir).toBeUndefined();
  });

  // The BB-218-canonical repo, end to end through `cmdUi`: an engine-only
  // `project.config.js` is deliberately NOT a connection source (BB-230
  // content-gate), so the connection is inherited from home — and yet the repo
  // is still the project we are standing in. Both halves are asserted together
  // because the bug they guard against is exactly them disagreeing: a `bakers ui`
  // that reads the right connection while rooting its agents somewhere else.
  it('AC-9: an engine-only BB-218 repo roots at its own root while inheriting the home connection', async () => {
    const d = join(tmp, '.bakers');
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, 'project.config.js'),
      `export default { project: { name: 'p' } };\n`,
    );
    const loader = fakeLoader();
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      // The connection legs (home) are core's; delegation is the
      // assertion here, exactly as the AC-3 case does it.
      loadConnection: loader.load,
      runUi: async (o) => {
        opts = o;
      },
    });
    // The engine config was never claimed as a connection — core resolves from
    // the cwd and reaches the home leg …
    expect(loader.calls).toEqual([{ cwd: tmp, explicit: undefined }]);
    // … while the rooting still names THIS repo, not the registry default.
    expect(opts?.cwd).toBe(tmp);
    expect(opts?.cwd).not.toBe('/repos/bakers/.bakers');
  });

  it('AC-9: an explicit --config does NOT relocate the rooting', async () => {
    makeProject(tmp, 'https://project.test');
    const explicit = join(tmp, 'custom.config.js');
    writeFileSync(
      explicit,
      `export default { site: { base_url: 'https://explicit.test' }, workspace_id: '00000000-0000-4000-8000-000000000000', plugins: [] };\n`,
    );
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      explicitConfig: explicit,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.configPath).toBe(explicit);
    expect(opts?.cwd).toBe(tmp);
  });

  // ── unchanged behaviour ───────────────────────────────────────────────────

  it('passes the signed-in user (api.me()) through as the current user', async () => {
    makeProject(tmp, 'https://project.test');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      buildWriteClient: async () => ({ me: async () => 'user-uuid' }),
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.currentUser).toBe('user-uuid');
  });

  it('runs without a current user when the identity cannot be read', async () => {
    makeProject(tmp, 'https://project.test');
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      cwd: tmp,
      buildWriteClient: async () => ({
        me: async () => {
          throw new Error('offline');
        },
      }),
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('currentUser');
  });

  // The stderr half is asserted, not only the exit code. This path used to
  // report through `logger.error`, which writes to `$HOME/log.txt` whenever
  // stdout is not a TTY — so an unresolvable connection came out of CI as
  // `exit 1` and no output at all, with the cause in a file on the runner. A
  // test that checks the code alone passes either way, which is why it did.
  it('errors (exit 1, a stderr line, renderer never launched) when the connection cannot be loaded', async () => {
    const saved = process.exitCode;
    process.exitCode = 0;
    let called = false;
    const err: string[] = [];
    await cmdUi({
      cwd: tmp,
      stderr: (s) => err.push(s),
      loadConnection: async () => {
        throw new Error('bakers connection config requires site.base_url');
      },
      runUi: async () => {
        called = true;
      },
    });
    expect(called).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(err.join('')).toContain('requires site.base_url');
    process.exitCode = saved;
  });

  it('--print-config still exits 1 on an unresolvable connection, and says why', async () => {
    const saved = process.exitCode;
    process.exitCode = 0;
    const out: string[] = [];
    const err: string[] = [];
    await cmdUi({
      cwd: tmp,
      printConfig: true,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      loadConnection: async () => {
        throw new Error('bakers connection config requires site.base_url');
      },
      runUi: async () => {},
    });
    expect(process.exitCode).toBe(1);
    // No report on stdout — there is no resolution to report — but the reason
    // reaches stderr, which is the whole point of running --print-config.
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('requires site.base_url');
    process.exitCode = saved;
  });
});

// BB-223 AC-1/AC-2/AC-3/AC-4/AC-7 — the entry seam: argv in, an optional
// typed `initialRoute` out, with every failure landing BEFORE the launcher.
describe('cmdUi deep-link entry seam (BB-223)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /**
   * Run `cmdUi` with the launcher faked; report what it got and the exit code.
   *
   * The connection loader is faked too, and that is load-bearing: these cases
   * are about the ROUTE seam, and a real `loadBbConfig` would make them depend
   * on the machine's `~/.bakers/` — which is exactly how the rung-2 case passed
   * locally and failed on CI (no home config there ⇒ `cmdUi` exited before the
   * launcher). BB-219's own suite covers connection resolution properly.
   */
  async function runEntry(deps: Parameters<typeof cmdUi>[0] = {}) {
    const savedExit = process.exitCode;
    process.exitCode = 0;
    const stderr: string[] = [];
    let opts: RunBbUiOptions | undefined;
    let called = false;
    await cmdUi({
      loadConnection: fakeLoader().load,
      stderr: (line) => stderr.push(line),
      runUi: async (o) => {
        called = true;
        opts = o;
      },
      ...deps,
    });
    const exitCode = process.exitCode;
    process.exitCode = savedExit;
    return { opts, called, exitCode, stderr: stderr.join('') };
  }

  it('threads a ticket target through as initialRoute (AC-3)', async () => {
    const { opts } = await runEntry({ target: 'BB-221' });
    expect(opts?.initialRoute).toEqual({
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-221',
      view: 'full',
    });
  });

  it('passes NO initialRoute for the bare command (AC-4 regression)', async () => {
    const { opts, called } = await runEntry();
    expect(called).toBe(true);
    expect(opts?.initialRoute).toBeUndefined();
    expect('initialRoute' in (opts as object)).toBe(false);
  });

  it('carries --view onto the route (AC-7)', async () => {
    const { opts } = await runEntry({ target: 'BB-221', view: 'teaser' });
    expect(opts?.initialRoute?.view).toBe('teaser');
  });

  it('rejects an unknown --view before the launcher runs (AC-7)', async () => {
    const { called, exitCode, stderr } = await runEntry({
      target: 'BB-221',
      view: 'banana',
    });
    expect(called).toBe(false);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('banana');
    expect(stderr).toContain('board_card');
  });

  it('rejects conflicting target sources before the launcher runs (AC-1)', async () => {
    const { called, exitCode, stderr } = await runEntry({
      target: 'BB-221',
      project: 'bakers',
    });
    expect(called).toBe(false);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--project');
    expect(stderr).toContain('BB-221');
  });

  it('--here on a ticket branch yields the ticket route (AC-2, rung 1)', async () => {
    const { opts } = await runEntry({
      here: true,
      readBranch: async () => 'feat/bb-222-conductor-cli-te',
      readRemoteUrl: async () => {
        throw new Error('rung 1 must not read the remote');
      },
    });
    expect(opts?.initialRoute).toMatchObject({
      kind: 'ticket',
      by: 'identifier',
      value: 'BB-222',
      fromBranch: 'feat/bb-222-conductor-cli-te',
    });
  });

  it("--here on `main` yields the repo target, by:'repo' (AC-2, rung 2)", async () => {
    const { opts, called } = await runEntry({
      here: true,
      cwd: '/a/fresh/clone',
      readBranch: async () => 'main',
      readRemoteUrl: async () =>
        'git@git.key-tec.de:bakers-build/bakers-build.git',
    });
    expect(called).toBe(true);
    expect(opts?.initialRoute).toMatchObject({
      kind: 'project',
      by: 'repo',
      value: 'git.key-tec.de/bakers-build/bakers-build',
    });
  });

  it('--here with no git remote fails naming the cwd, before any network call (AC-2, rung 3)', async () => {
    let connectionLoaded = false;
    const { called, exitCode, stderr } = await runEntry({
      here: true,
      cwd: '/tmp/bb-223-nowhere',
      readBranch: async () => 'main',
      readRemoteUrl: async () => '',
      loadConnection: async () => {
        connectionLoaded = true;
        throw new Error('the connection must not be loaded');
      },
    });
    expect(called).toBe(false);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('/tmp/bb-223-nowhere');
    expect(stderr).toContain('git remote');
    // The whole ladder is offline: a `--here` that cannot resolve costs no
    // config load and no round trip (spec Decision 5).
    expect(connectionLoaded).toBe(false);
  });

  it('surfaces a launcher rejection as exit 1, never an unhandled rejection (AC-3)', async () => {
    const { exitCode, stderr } = await runEntry({
      target: 'BB-999999',
      runUi: async () => {
        throw new Error('no ticket BB-999999 on https://bakers.example');
      },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('no ticket BB-999999');
  });
});

// AC-3 (manifest): @bakers-build/ui must NOT depend on @bakers-build/conductor — the
// cockpit is independent of the per-project engine package.
describe('@bakers-build/ui package independence (AC-3)', () => {
  it('has no @bakers-build/conductor dependency', () => {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@bakers-build/conductor']).toBeUndefined();
    expect(pkg.peerDependencies?.['@bakers-build/conductor']).toBeUndefined();
  });
});

// ── BB-233 write seam, as BB-391 leaves it ─────────────────────────────
//
// The seam SURVIVES; the two profiles do not. `bakers ui` used to pin `session`
// for reads and build a second, `pm`-scoped client for writes, because at
// granularity `role` the requested OAuth scope alone decided which role a token
// carried. BB-359 moved capability onto OG ranks, so both scopes resolve to
// the same role and the split was ceremony.
//
// It does NOT collapse to one client object, and this describe says so rather
// than implying otherwise (spec D6): the READ client lives inside dropsh — the
// TUI renders within the dropsh program, which resolves auth itself — and is
// unreachable from `ui.ts`. So `buildWriteClient` stays, and resolves the
// connection's DEFAULT provider with no profile named. Two client objects, ONE
// identity.

describe('cmdUi write client (BB-233, one identity per BB-391)', () => {
  const base = {};

  it('builds the write client with NO profile and delegates it', async () => {
    const asked: Record<string, unknown>[] = [];
    const built = { marker: 'the write client' };
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      ...base,
      loadConnection: fakeLoader().load,
      buildWriteClient: async (o) => {
        asked.push({ ...o });
        return built;
      },
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.baseUrl).toBe('https://bakers.example');
    // AC2: no profile is passed — not `'pm'`, not `undefined` under the key.
    expect(asked[0]).not.toHaveProperty('profile');
    expect(opts?.writeClient).toBe(built);
    // …and the connection carries neither profile field any more.
    expect(opts?.connection).not.toHaveProperty('authProfile');
    expect(opts?.connection).not.toHaveProperty('writeProfile');
  });

  it('degrades to the read client, naming NO profile, when the write client cannot be built', async () => {
    // The degrade path survives BB-391; what it USED to do does not. It used to
    // rename the profile the write would really use (`writeProfile = authProfile`)
    // so the popup could say so — and that rename is gone with the fields.
    //
    // The fallback itself stays because a connection with no resolvable auth
    // provider still READS: `resolveAuth` throws for a `plugins[]` that yields
    // none, and a `@bakers-build/addon-auth-basic` connection arrives here the same
    // way. Aborting would take the cockpit down over a write seam it may never
    // use, so no write client is injected and the server's own 403 is the answer.
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      ...base,
      loadConnection: fakeLoader().load,
      buildWriteClient: async () => {
        throw new Error('no configured auth provider');
      },
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.writeClient).toBeUndefined();
    // AC2: the degrade names no profile, because there is no longer one to name.
    expect(opts?.connection).not.toHaveProperty('writeProfile');
    expect(opts?.connection).not.toHaveProperty('authProfile');
    // A missing write client must never abort the cockpit — reads still work.
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('the READ connection is unchanged by the write seam', async () => {
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      ...base,
      loadConnection: fakeLoader().load,
      buildWriteClient: async () => ({}),
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.baseUrl).toBe('https://bakers.example');
    expect(opts?.connection.configPath).toBe('/resolved/connection.config.js');
  });
});

// BB-495 D1: essentials no longer contributes the ambient-workspace plugin,
// so `bakers ui` attaches it itself, right after the connection resolves, using
// the workspace it already knows. Dropsh does not do this any more — the
// caller names the workspace on the call.
describe('cmdUi attaches the ambient workspace plugin to its own chain (BB-495)', () => {
  const base = {};

  it('attaches the ambient workspace plugin to its own chain', async () => {
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      ...base,
      loadConnection: fakeLoader({
        workspace_id: '00000000-0000-4000-8000-000000000000',
      }).load,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.authPlugins?.map((p) => p.id)).toContain(
      'bakers-workspace',
    );
  });

  it('attaches no workspace plugin when the resolved connection names none', async () => {
    let opts: RunBbUiOptions | undefined;
    await cmdUi({
      ...base,
      loadConnection: fakeLoader({ workspace_id: undefined }).load,
      runUi: async (o) => {
        opts = o;
      },
    });
    expect(opts?.connection.authPlugins?.map((p) => p.id)).not.toContain(
      'bakers-workspace',
    );
  });
});
