import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProjectRooting } from '../src/ui-home.js';

// BB-219 (AC-9, D5): `bakers ui` roots in the project you STARTED IT IN, not in
// whatever project the conductor registry happens to prefer. The trigger is the
// cwd — deliberately NOT the winning connection config, so an explicit
// `--config` cannot silently relocate the cockpit's working directory.
// The walk-up itself is core's `findProjectBbDir` — "is there a `.bakers/`
// here", NOT the connection walk-up `findBbConfig`, which since BB-230
// skips an engine-only `project.config.js`. This helper only decides what to
// do with its answer, and owns no `existsSync` of its own (AC-6).
describe('resolveProjectRooting (AC-9)', () => {
  let tmp: string;
  let home: string;

  const makeProject = (
    root: string,
    file = 'connection.config.js',
    src = 'export default {};\n',
  ): string => {
    const d = join(root, '.bakers');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, file), src);
    return d;
  };

  const originalBbHome = process.env.BAKERS_HOME;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bakers-root-'));
    home = mkdtempSync(join(tmpdir(), 'bakers-rhome-'));
    // `resolveProjectRooting`'s `.bakers`-root comparison goes through
    // `homeBbDir()` with no argument, so a fixture that wants its OWN
    // `home/.bakers` excluded from the walk-up must point
    // BAKERS_HOME there instead of relying on the `homeDir` parameter, which is
    // now only the fallback cwd.
    process.env.BAKERS_HOME = join(home, '.bakers');
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (originalBbHome === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = originalBbHome;
  });

  it('roots at the repo root — NOT the .bakers dir — inside a project', () => {
    const bakersDir = makeProject(tmp);
    const r = resolveProjectRooting(tmp, home);
    expect(r.cwd).toBe(tmp);
    expect(r.cwd).not.toBe(bakersDir);
  });

  it('hands over the .bakers dir so the renderer can identify this conductor', () => {
    // The project name and this machine's conductor id used to be read from a
    // local registry here. They now resolve in the renderer, which has the
    // JSON:API client this entry lacks: it matches this dir against each
    // conductor's workspace_root.
    const bakersDir = makeProject(tmp);
    const r = resolveProjectRooting(tmp, home);
    expect(r.bakersDir).toBe(bakersDir);
  });

  it('roots at the repo root even when no conductor ever ran here', () => {
    makeProject(tmp);
    const r = resolveProjectRooting(tmp, home);
    expect(r.cwd).toBe(tmp);
  });

  it('walks up: a nested subdirectory roots at the same repo root', () => {
    const _bakersDir = makeProject(tmp);
    const sub = join(tmp, 'packages', 'ui', 'src');
    mkdirSync(sub, { recursive: true });
    const r = resolveProjectRooting(sub, home);
    expect(r.cwd).toBe(tmp);
  });

  // The BB-218-canonical repo shape, and the regression the BB-230 rebase
  // would otherwise have introduced here: an engine-only `project.config.js`
  // is deliberately NOT a connection source (its connection is inherited from
  // `~/.bakers/connections/default.js`), but it is unambiguously a project. Keying AC-9
  // on the connection walk-up would root the most common repo shape in the
  // registry default instead of its own root.
  it('an engine-only project.config.js still marks a project (BB-218 shape)', () => {
    const bakersDir = makeProject(
      tmp,
      'project.config.js',
      "export default { project: { name: 'p' } };\n",
    );
    const r = resolveProjectRooting(tmp, home);
    expect(r.cwd).toBe(tmp);
    expect(r.cwd).not.toBe(bakersDir);
  });

  it('an engine-only project resolved from a nested subdirectory roots at its root', () => {
    const _bakersDir = makeProject(
      tmp,
      'project.config.js',
      "export default { project: { name: 'p' } };\n",
    );
    const sub = join(tmp, 'bakers-cli', 'ui', 'src');
    mkdirSync(sub, { recursive: true });
    const r = resolveProjectRooting(sub, home);
    expect(r.cwd).toBe(tmp);
  });

  it('a variant-only .bakers dir marks a project too', () => {
    const _bakersDir = makeProject(
      tmp,
      'project.shop.config.js',
      "export default { project: { name: 'p' } };\n",
    );
    const r = resolveProjectRooting(tmp, home);
    expect(r.cwd).toBe(tmp);
  });

  it('outside any project: the home dir, and no project claimed', () => {
    // The registry used to supply a "default project" here — the first entry of
    // a file that could name a checkout deleted months ago. An empty cockpit is
    // the honest answer; the conductor list itself is one screen away.
    const r = resolveProjectRooting(tmp, home);
    expect(r.cwd).toBe(home);
    expect(r.bakersDir).toBeUndefined();
  });

  // The truthfulness guard, mirroring core's D4 correction: without it every
  // directory under $HOME would look like "a project rooted at $HOME", because
  // the walk-up reaches ~/.bakers from anywhere below it.
  it('does NOT treat ~/.bakers as a project — a cwd under $HOME roots at home', () => {
    makeProject(home);
    const sub = join(home, 'scratch');
    mkdirSync(sub, { recursive: true });
    const r = resolveProjectRooting(sub, home);
    expect(r.cwd).toBe(home);
    expect(r.bakersDir).toBeUndefined();
  });

  it('a real project nested under $HOME is still a project', () => {
    makeProject(home);
    const repo = join(home, 'projects', 'thing');
    const _bakersDir = makeProject(repo);
    const r = resolveProjectRooting(repo, home);
    expect(r.cwd).toBe(repo);
  });
});
