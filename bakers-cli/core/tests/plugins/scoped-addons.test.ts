import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AddonEntry,
  type AddonScopeInput,
  discoverScoped,
  readAddonCapabilities,
  readEffectiveAddon,
  scopeAddons,
} from '../../src/index.js';

// The effective addon list: machine and project `addons[]` read the same way,
// each addon decides where it may be listed, and the machine entry wins.

let pkgDir: string;
let machineDir: string;
let projectDir: string;
let warnings: string[];
const logger = {
  warn: (_o: unknown, msg: string) => warnings.push(msg),
} as unknown as NonNullable<Parameters<typeof scopeAddons>[1]>['logger'];

/** An addon at an absolute path, so both scopes resolve the same module. */
function addon(name: string, body: string): string {
  const path = join(pkgDir, name);
  writeFileSync(path, body);
  return path;
}

const REMOTE = `export const servers = (acc, opts) => [...acc, { kind: 'server', id: 'r', opts }];`;

function machine(entries: AddonEntry[]): AddonScopeInput {
  return {
    scope: 'machine',
    path: join(machineDir, 'machine.config.js'),
    entries,
    bases: [pathToFileURL(`${machineDir}/`).href],
  };
}
function project(entries: AddonEntry[]): AddonScopeInput {
  return {
    scope: 'project',
    path: join(projectDir, 'project.config.js'),
    entries,
    bases: [pathToFileURL(`${projectDir}/`).href],
  };
}
const withOf = (entry: AddonEntry) =>
  typeof entry === 'string' ? undefined : entry.with;

beforeEach(() => {
  pkgDir = mkdtempSync(join(tmpdir(), 'bakers-scoped-pkg-'));
  machineDir = mkdtempSync(join(tmpdir(), 'bakers-scoped-m-'));
  projectDir = mkdtempSync(join(tmpdir(), 'bakers-scoped-p-'));
  warnings = [];
});

describe('scopeAddons', () => {
  it('expands nested addons before the parent once, with their origin', async () => {
    const child = addon('child.js', REMOTE);
    const parent = addon(
      'parent.js',
      `${REMOTE}\nexport const addons = [${JSON.stringify(child)}];`,
    );
    const { addons } = await scopeAddons([project([parent, child])], {
      logger,
    });
    expect(addons.map((a) => a.entry)).toEqual([child, parent]);
    const nested = await scopeAddons([project([parent])]);
    expect(nested.addons[0]).toMatchObject({ via: parent });
    const out = await discoverScoped(addons, 'conductor', { logger });
    expect(out.servers).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('rejects cycles with the complete chain', async () => {
    const a = join(pkgDir, 'a.js');
    const b = addon('b.js', `export const addons = [${JSON.stringify(a)}];`);
    addon('a.js', `export const addons = [${JSON.stringify(b)}];`);
    await expect(scopeAddons([project([a])])).rejects.toThrow(
      `${a} -> ${b} -> ${a}`,
    );
  });

  it('silently skips nested project-only addons in machine scope', async () => {
    const child = addon(
      'child.js',
      `${REMOTE}\nexport const scopes = ['project'];`,
    );
    const parent = addon(
      'parent.js',
      `export const addons = [${JSON.stringify(child)}];`,
    );
    const result = await scopeAddons([machine([parent])], { logger });
    expect(result.addons.map((a) => a.entry)).toEqual([parent]);
    expect(result.findings).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('names the parent of an unresolved child and retains the scope error policy', async () => {
    const parent = addon('parent.js', `export const addons = ['@nope/child'];`);
    await expect(scopeAddons([project([parent])])).rejects.toThrow(
      `via ${parent}`,
    );
    const result = await scopeAddons([machine([parent])], { logger });
    expect(result.addons.map((a) => a.entry)).toEqual([parent]);
    expect(warnings[0]).toContain(`via ${parent}`);
  });

  it('loads the project-only partner when its parent is effective in both scopes', async () => {
    const child = addon(
      'child.js',
      `${REMOTE}\nexport const scopes = ['project'];`,
    );
    const parent = addon(
      'parent.js',
      `export const addons = [${JSON.stringify(child)}];`,
    );
    const result = await scopeAddons([machine([parent]), project([parent])]);
    expect(
      result.addons.map((a) =>
        typeof a.entry === 'string' ? a.entry : a.entry.use,
      ),
    ).toEqual([parent, child]);
    expect(result.addons[1]?.scope).toBe('project');
  });

  it('machine with replaces project with', async () => {
    const spec = addon('both.js', REMOTE);
    const { addons } = await scopeAddons([
      project([{ use: spec, with: { a: 1, b: 2 } }]),
      machine([{ use: spec, with: { a: 9 } }]),
    ]);
    expect(addons).toHaveLength(1);
    expect(addons[0]?.scope).toBe('machine');
    expect(withOf(addons[0]!.entry)).toEqual({ a: 9 });
  });

  it('project with is kept when machine has none', async () => {
    const spec = addon('both.js', REMOTE);
    const { addons } = await scopeAddons([
      machine([spec]),
      project([{ use: spec, with: { a: 1 } }]),
    ]);
    expect(addons).toHaveLength(1);
    expect(withOf(addons[0]!.entry)).toEqual({ a: 1 });
  });

  it('mergeWith decides when exported', async () => {
    const spec = addon(
      'merge.js',
      `${REMOTE}\nexport const mergeWith = (p, m) => ({ ...p, ...m });`,
    );
    const { addons } = await scopeAddons([
      machine([{ use: spec, with: { a: 9 } }]),
      project([{ use: spec, with: { a: 1, b: 2 } }]),
    ]);
    expect(withOf(addons[0]!.entry)).toEqual({ a: 9, b: 2 });
  });

  it('undeclared scope is reported and not loaded', async () => {
    const spec = addon(
      'project-only.js',
      `${REMOTE}\nexport const scopes = ['project'];`,
    );
    const { addons, findings } = await scopeAddons([machine([spec])], {
      logger,
    });
    expect(addons).toEqual([]);
    expect(findings).toEqual([
      {
        code: 'addon_scope_not_allowed',
        spec,
        path: join(machineDir, 'machine.config.js'),
        scope: 'machine',
        allowed: ['project'],
      },
    ]);
    expect(warnings[0]).toContain(spec);
    expect(warnings[0]).toContain('machine.config.js');
    expect(warnings[0]).toContain('.bakers/project.config.js');
  });

  it('undeclared addon is allowed in both scopes', async () => {
    const a = addon('a.js', REMOTE);
    const b = addon('b.js', REMOTE);
    const { addons, findings } = await scopeAddons([
      machine([a]),
      project([b]),
    ]);
    expect(addons.map((x) => x.entry)).toEqual([a, b]);
    expect(findings).toEqual([]);
  });

  it('keeps different aliases separate', async () => {
    const spec = addon('both.js', REMOTE);
    const { addons } = await scopeAddons([
      machine([{ use: spec, alias: 'one', with: { a: 1 } }]),
      project([{ use: spec, alias: 'two', with: { a: 2 } }]),
    ]);
    expect(addons.map((x) => [x.scope, withOf(x.entry)])).toEqual([
      ['machine', { a: 1 }],
      ['project', { a: 2 }],
    ]);
  });

  it('skips an unresolvable machine entry with a warning', async () => {
    const spec = addon('both.js', REMOTE);
    const { addons } = await scopeAddons(
      [machine(['@nope/missing']), project([spec])],
      { logger },
    );
    expect(addons.map((x) => x.entry)).toEqual([spec]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('@nope/missing');
    expect(warnings[0]).toContain(join(machineDir, 'machine.config.js'));
  });

  it('throws for an unresolvable project entry', async () => {
    await expect(scopeAddons([project(['@nope/missing'])])).rejects.toThrow(
      "cannot resolve addon '@nope/missing'",
    );
  });

  it('orders machine entries first', async () => {
    const a = addon('a.js', REMOTE);
    const b = addon('b.js', REMOTE);
    const { addons } = await scopeAddons([project([b]), machine([a])]);
    expect(addons.map((x) => x.scope)).toEqual(['machine', 'project']);
  });
});

describe('discoverScoped', () => {
  it('resolves each entry against its own scope bases', async () => {
    writeFileSync(join(machineDir, 'm.js'), REMOTE);
    writeFileSync(join(projectDir, 'p.js'), REMOTE);
    const { addons } = await scopeAddons([
      machine([{ use: './m.js', with: 'm' }]),
      project([{ use: './p.js', with: 'p' }]),
    ]);
    const out = await discoverScoped(addons, 'conductor');
    expect(out.servers.map((r) => (r as { opts: unknown }).opts)).toEqual([
      'm',
      'p',
    ]);
  });
});

describe('readEffectiveAddon', () => {
  it('reads one addon from machine and nearest project config', async () => {
    const spec = addon('both.js', REMOTE);
    const home = join(machineDir, 'home');
    mkdirSync(join(home, '.bakers'), { recursive: true });
    writeFileSync(
      join(home, '.bakers', 'machine.config.js'),
      `export default { addons: [${JSON.stringify(spec)}] };`,
    );
    mkdirSync(join(projectDir, '.bakers'));
    const projectPath = join(projectDir, '.bakers', 'project.config.js');
    writeFileSync(
      projectPath,
      `export default { addons: [{ use: ${JSON.stringify(spec)}, with: { a: 1 } }] };`,
    );
    const found = await readEffectiveAddon(spec, {
      cwd: projectDir,
      home,
      projectPath,
    });
    expect(found?.scope).toBe('machine');
    expect(withOf(found!.entry)).toEqual({ a: 1 });
  });

  it('returns undefined when no scope lists the addon', async () => {
    const found = await readEffectiveAddon('@nope/x', {
      cwd: projectDir,
      home: join(machineDir, 'empty'),
    });
    expect(found).toBeUndefined();
  });
});

it('reads slots and nested origins from presets without running accumulators', async () => {
  const child = addon(
    'workspace.js',
    `export const scopes = ['project']; export const worktrees = () => { throw Error('must not run'); };`,
  );
  const parent = addon(
    'executor.js',
    `export const executors = () => []; export const addons = [${JSON.stringify(child)}];`,
  );
  const result = await readAddonCapabilities(
    [parent, '@nope/missing'],
    [import.meta.url],
  );
  expect(result[parent]).toMatchObject({
    slots: ['worktree', 'executor'],
    scopes: ['machine', 'project'],
  });
  expect(result[parent]?.contributions).toContainEqual({
    slot: 'worktree',
    spec: child,
    via: parent,
  });
  expect(result['@nope/missing']).toBeUndefined();
});
