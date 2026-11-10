import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findBbConfig,
  findProjectBbDir,
  homeBbDir,
  resolveBbConfigPath,
  stemForConfigFile,
} from '../../src/cli/bakers-dir.js';

/** The home default connection, `~/.bakers/connections/default.js`. */
const writeHomeConnection = (home: string, src = 'export default {};\n') => {
  const d = join(home, '.bakers', 'connections');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'default.js'), src);
  return join(d, 'default.js');
};
const homeConnection = (home: string) =>
  join(home, '.bakers', 'connections', 'default.js');

// AC-4: the CONNECTION precedence — explicit → project walk-up
// (`.bakers/connection.config.js`) → home `connections/default.js`.
describe('resolveBbConfigPath (connection precedence, AC-4)', () => {
  let tmp: string;
  let home: string;

  const bakersDir = (root: string) => {
    const d = join(root, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const write = (dir: string, name: string) =>
    writeFileSync(join(dir, name), 'export default {};\n');

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-conn-'));
    home = mkdtempSync(join(tmpdir(), 'bakers-home-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('(1) explicit wins verbatim over everything', () => {
    write(bakersDir(tmp), 'connection.config.js');
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
      explicit: '/x/custom.config.js',
    });
    expect(r).toEqual({
      path: '/x/custom.config.js',
      fallback: false,
      legacy: false,
      source: 'explicit',
    });
  });

  it('(2) project ./.bakers/connection.config.js walk-up wins', () => {
    const proj = bakersDir(tmp);
    write(proj, 'connection.config.js');
    const sub = join(tmp, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = resolveBbConfigPath({
      cwd: sub,
      home,
    });
    expect(r).toEqual({
      path: join(proj, 'connection.config.js'),
      fallback: false,
      legacy: false,
      source: 'project',
    });
  });

  // BB-230: a project file that still DECLARES a connection (a top-level
  // `site`) is never a connection source. The engine-only variant is covered
  // below as AC-6.
  it('(2b) a project.config.js never supplies a runtime connection', () => {
    const proj = bakersDir(tmp);
    writeFileSync(
      join(proj, 'project.config.js'),
      "export default { site: { base_url: 'https://legacy.test' }, plugins: [] };\n",
    );
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('(2c) a project connection.config.js wins over a co-located project.config.js', () => {
    const proj = bakersDir(tmp);
    write(proj, 'project.config.js');
    write(proj, 'connection.config.js');
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r.path).toBe(join(proj, 'connection.config.js'));
    expect(r.legacy).toBe(false);
  });

  it('(3) no project → home ~/.bakers/connections/default.js when present', () => {
    writeHomeConnection(home);
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('(4) no project + no home → missing canonical connection path', () => {
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('does not read an old bakers.config.js, in the project or at home', () => {
    write(bakersDir(tmp), 'bakers.config.js');
    write(bakersDir(home), 'bakers.config.js');
    expect(resolveBbConfigPath({ cwd: tmp, home })).toMatchObject({
      path: homeConnection(home),
      source: 'home',
    });
  });

  it('findBbConfig returns undefined when neither file exists up the tree', () => {
    expect(findBbConfig(tmp)).toBeUndefined();
  });

  // BB-219 (D4): `source` names WHICH leg of the precedence produced the
  // path. It is additive and purely diagnostic — resolution behaviour is
  // unchanged — but it exists so a consumer (`bakers ui --print-config`) can
  // report "project vs home" WITHOUT re-deriving the rule for itself, which
  // would be exactly the second precedence implementation AC-6 forbids.
  describe('source (BB-219 D4)', () => {
    it('reports `explicit` for an explicitly named config', () => {
      write(bakersDir(tmp), 'connection.config.js');
      expect(
        resolveBbConfigPath({
          cwd: tmp,
          home,
          explicit: '/x/custom.config.js',
        }).source,
      ).toBe('explicit');
    });

    it('reports `project` for a config found by walk-up', () => {
      write(bakersDir(tmp), 'connection.config.js');
      const sub = join(tmp, 'a', 'b');
      mkdirSync(sub, { recursive: true });
      expect(resolveBbConfigPath({ cwd: sub, home }).source).toBe('project');
    });

    it('skips project-file credentials while resolving the canonical global owner', () => {
      // A project file is never a connection, even one declaring `site`
      // (BB-230); the content-gate suite below pins the engine-only case.
      writeFileSync(
        join(bakersDir(tmp), 'project.config.js'),
        "export default { site: { base_url: 'https://legacy.test' } };\n",
      );
      const r = resolveBbConfigPath({
        cwd: tmp,
        home,
      });
      expect(r.source).toBe('home');
      expect(r.legacy).toBe(false);
    });

    it('reports `home` for the home config reached by the home leg', () => {
      writeHomeConnection(home);
      expect(resolveBbConfigPath({ cwd: tmp, home }).source).toBe('home');
    });

    it('reports the home owner when its connection is absent', () => {
      expect(resolveBbConfigPath({ cwd: tmp, home }).source).toBe('home');
    });

    // The truthfulness correction. Core's walk-up climbs to the filesystem
    // root, so from any cwd under $HOME it passes `~/.bakers`. Whatever it
    // finds there, labelling the home connection `project` would make the
    // report lie about where the connection came from.
    it('reports `home`, not `project`, when the walk-up itself reached ~/.bakers', () => {
      const homeCfg = writeHomeConnection(home);
      const sub = join(home, 'some', 'repo');
      mkdirSync(sub, { recursive: true });
      const r = resolveBbConfigPath({
        cwd: sub,
        home,
      });
      // The resolved path is unchanged by this correction …
      expect(r.path).toBe(homeCfg);
      // … only the label is made truthful.
      expect(r.source).toBe('home');
    });

    it('still reports `project` for a real project nested under $HOME', () => {
      writeHomeConnection(home);
      const repo = join(home, 'projects', 'thing');
      write(bakersDir(repo), 'connection.config.js');
      const r = resolveBbConfigPath({
        cwd: repo,
        home,
      });
      expect(r.path).toBe(join(repo, '.bakers', 'connection.config.js'));
      expect(r.source).toBe('project');
    });
  });

  // BB-218 AC-1: a repo with NO project connection config resolves the GLOBAL
  // connection — the home `~/.bakers/connections/default.js`. This is the
  // "conductor inherits its connection" default: no project override is
  // required.
  it('AC-1: a `.bakers/`-less repo resolves the home connection when present', () => {
    writeHomeConnection(home);
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('AC-1: a `.bakers/`-less repo with no home connection resolves the absent canonical connection', () => {
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });
});

// BB-230: a project file (`project.config.js`, the engine config) must never
// shadow the home `~/.bakers/connections/default.js` that BB-218 defines as
// every repo's inherited default — whether or not it declares a `site`.
describe('a project file is never a connection source (BB-230)', () => {
  let tmp: string;
  let home: string;

  const bakersDir = (root: string) => {
    const d = join(root, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const writeSrc = (dir: string, name: string, src: string) =>
    writeFileSync(join(dir, name), src);

  /** The canonical project file: engine-only, no `site`. */
  const ENGINE_ONLY = `export default {
  schema_version: 1,
  project: { name: 'p' },
  server: { use: '@bakers-build/addon-remote-drupal' },
};
`;
  /** A project file that still carries a connection. */
  const LEGACY_WITH_SITE = `export default {
  site: { base_url: 'https://legacy.test' },
  plugins: [],
  project: { name: 'p' },
};
`;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bb-230-cwd-'));
    home = mkdtempSync(join(tmpdir(), 'bb-230-home-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('AC-6: an engine-only project.config.js falls through to the home connection', () => {
    writeSrc(bakersDir(tmp), 'project.config.js', ENGINE_ONLY);
    writeHomeConnection(home);
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('AC-6: with no home connection either, it resolves the absent canonical connection', () => {
    writeSrc(bakersDir(tmp), 'project.config.js', ENGINE_ONLY);
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('AC-6: findBbConfig does not claim an engine-only project.config.js', () => {
    writeSrc(bakersDir(tmp), 'project.config.js', ENGINE_ONLY);
    expect(findBbConfig(tmp)).toBeUndefined();
  });

  it('AC-7: a project.config.js declaring site never shadows the global connection', () => {
    const proj = bakersDir(tmp);
    writeSrc(proj, 'project.config.js', LEGACY_WITH_SITE);
    writeHomeConnection(home);
    const r = resolveBbConfigPath({
      cwd: tmp,
      home,
    });
    expect(r).toEqual({
      path: homeConnection(home),
      fallback: false,
      legacy: false,
      source: 'home',
    });
  });

  it('AC-7: a variant project.<name>.config.js is never a connection source', () => {
    writeSrc(bakersDir(tmp), 'project.shop.config.js', LEGACY_WITH_SITE);
    writeHomeConnection(home);
    expect(resolveBbConfigPath({ cwd: tmp, home }).path).toBe(
      homeConnection(home),
    );
  });
});

// BB-219 AC-9: "which project am I standing in" is a DIFFERENT question from
// "where does my connection come from". Since BB-230 the connection walk-up
// skips an engine-only `conductor.config.js`, and BB-218 makes exactly that
// the canonical repo shape — so project detection is content-agnostic and keys
// on the `.bakers/` dir holding any bakers config at all.
describe('findProjectBbDir (project marker, AC-9)', () => {
  let tmp: string;
  const bakersDir = (root: string) => {
    const d = join(root, '.bakers');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const writeSrc = (dir: string, name: string, src: string) =>
    writeFileSync(join(dir, name), src);
  const ENGINE_ONLY = "export default { project: { name: 'p' } };\n";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-projdir-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('claims an engine-only project.config.js that findBbConfig skips', () => {
    const d = bakersDir(tmp);
    writeSrc(d, 'project.config.js', ENGINE_ONLY);
    expect(findBbConfig(tmp)).toBeUndefined();
    expect(findProjectBbDir(tmp)).toBe(d);
  });

  it('claims a connection.config.js-only .bakers dir, which findBbDir would miss', () => {
    const d = bakersDir(tmp);
    writeSrc(d, 'connection.config.js', 'export default {};\n');
    expect(findProjectBbDir(tmp)).toBe(d);
  });

  it('claims a variant-only .bakers dir', () => {
    const d = bakersDir(tmp);
    writeSrc(d, 'project.shop.config.js', ENGINE_ONLY);
    expect(findProjectBbDir(tmp)).toBe(d);
  });

  it('walks up from a nested subdirectory', () => {
    const d = bakersDir(tmp);
    writeSrc(d, 'project.config.js', ENGINE_ONLY);
    const sub = join(tmp, 'a', 'b', 'c');
    mkdirSync(sub, { recursive: true });
    expect(findProjectBbDir(sub)).toBe(d);
  });

  it('an EMPTY .bakers dir is not a project', () => {
    bakersDir(tmp);
    expect(findProjectBbDir(tmp)).toBeUndefined();
  });

  it('a .bakers dir holding only unrelated files is not a project', () => {
    const d = bakersDir(tmp);
    writeSrc(d, 'vite.config.js', 'export default {};\n');
    writeSrc(d, 'myconductor.config.js', ENGINE_ONLY);
    expect(findProjectBbDir(tmp)).toBeUndefined();
  });

  it('returns undefined with no .bakers anywhere up the tree', () => {
    const sub = join(tmp, 'a');
    mkdirSync(sub, { recursive: true });
    expect(findProjectBbDir(sub)).toBeUndefined();
  });
});

describe('stemForConfigFile', () => {
  it('maps the default config file to the `conductor` stem', () => {
    expect(stemForConfigFile('project.config.js')).toBe('conductor');
  });

  it('maps a variant file to its variant stem', () => {
    expect(stemForConfigFile('project.shop.config.js')).toBe('shop');
  });

  it('no longer recognises the old conductor file names', () => {
    expect(stemForConfigFile('conductor.config.js')).toBeUndefined();
    expect(stemForConfigFile('shop.conductor.config.js')).toBeUndefined();
    expect(stemForConfigFile('project.conductor.config.js')).toBeUndefined();
  });

  it('is the exact inverse of the rule the loader lists stems by', () => {
    // The near-misses this rule exists to exclude. A conductor deriving its own
    // name by slicing the filename would disagree with the loader on every one
    // of these, and report a name `--conductor` cannot select.
    expect(stemForConfigFile('myconductor.config.js')).toBeUndefined();
    expect(stemForConfigFile('vite.config.js')).toBeUndefined();
    expect(stemForConfigFile('bakers.config.js')).toBeUndefined();
    expect(stemForConfigFile('connection.config.js')).toBeUndefined();
    expect(stemForConfigFile('.conductor.config.js')).toBeUndefined();
    expect(stemForConfigFile('conductor.config.local.js')).toBeUndefined();
  });
});

describe('the .bakers root', () => {
  const original = process.env.BAKERS_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = original;
  });

  it('defaults to .bakers under the operating-system home', () => {
    delete process.env.BAKERS_HOME;
    expect(homeBbDir()).toBe(join(homedir(), '.bakers'));
  });

  it('is the directory BAKERS_HOME names, not a home containing one', () => {
    process.env.BAKERS_HOME = join(tmpdir(), 'bakers-home-probe');
    expect(homeBbDir()).toBe(join(tmpdir(), 'bakers-home-probe'));
  });

  it('resolves a relative BAKERS_HOME so a config value is never ambiguous', () => {
    process.env.BAKERS_HOME = 'relative-bakers';
    expect(homeBbDir()).toBe(resolve('relative-bakers'));
  });

  it('lets an explicit home win over the environment', () => {
    process.env.BAKERS_HOME = join(tmpdir(), 'ignored');
    expect(homeBbDir('/opt/someone')).toBe(join('/opt/someone', '.bakers'));
  });
});
