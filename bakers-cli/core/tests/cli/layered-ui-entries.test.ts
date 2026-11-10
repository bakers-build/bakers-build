import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  machineUiConfigPath,
  projectConductorConfigPath,
  readUiEntryLayers,
} from '../../src/cli/layered-ui-entries.js';
import { machineContextPath } from '../../src/cli/machine-context.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bakers-layers-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const write = (rel: string, body: string) => {
  const path = join(tmp, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
};

it('reads uiEntries from a config `addons[]` and nothing else', async () => {
  write(
    'tab.js',
    `export const uiEntries = (acc) => [...acc, './rendered.js'];
     export const executors = (acc) => [...acc, { kind: 'executor', id: 'x', requiredModules: [] }];`,
  );
  const path = write('conf.js', `export default { addons: ['./tab.js'] };`);
  const { machine: layer } = await readUiEntryLayers({
    machine: { path, bases: [pathToFileURL(`${tmp}/`).href] },
  });
  expect(layer.entries).toEqual(['./rendered.js']);
  expect(layer.path).toBe(path);
});

it('returns an empty layer for an absent file', async () => {
  const { machine: layer } = await readUiEntryLayers({
    machine: { path: join(tmp, 'nope.js'), bases: [] },
  });
  expect(layer.entries).toEqual([]);
});

it('returns an empty layer for a config with no addons[]', async () => {
  const path = write('conf.js', `export default { project: { name: 'p' } };`);
  const { machine: layer } = await readUiEntryLayers({
    machine: { path, bases: [] },
  });
  expect(layer.entries).toEqual([]);
});

it('skips an unresolvable addon, warns with the config path, keeps the rest', async () => {
  write(
    'tab.js',
    `export const uiEntries = (acc) => [...acc, './rendered.js'];`,
  );
  const path = write(
    'conf.js',
    `export default { addons: ['./gone.js', './tab.js'] };`,
  );
  const warnings: string[] = [];
  const { machine: layer } = await readUiEntryLayers({
    machine: { path, bases: [pathToFileURL(`${tmp}/`).href] },
    logger: { warn: (_o, m) => warnings.push(m) } as never,
  });
  expect(layer.entries).toEqual(['./rendered.js']);
  expect(warnings.join('\n')).toContain(path);
  expect(warnings.join('\n')).toContain("'./gone.js'");
});

it('returns an empty layer when the config module itself throws', async () => {
  const path = write('conf.js', `throw new Error('bad config');`);
  const { machine: layer } = await readUiEntryLayers({
    machine: { path, bases: [] },
  });
  expect(layer.entries).toEqual([]);
});

it('ui addon in both scopes renders one tab', async () => {
  const tab = write(
    'pkg/tab.js',
    `export const uiEntries = (acc, opts) => [...acc, opts?.tab ?? './default.js'];`,
  );
  const machine = write(
    'home/.bakers/machine.config.js',
    `export default { addons: [{ use: ${JSON.stringify(tab)}, with: { tab: './machine.js' } }] };`,
  );
  const project = write(
    'proj/.bakers/project.config.js',
    `export default { addons: [{ use: ${JSON.stringify(tab)}, with: { tab: './project.js' } }] };`,
  );
  const layers = await readUiEntryLayers({
    machine: { path: machine, bases: [pathToFileURL(`${tmp}/`).href] },
    project: { path: project, bases: [pathToFileURL(`${tmp}/`).href] },
  });
  expect(layers.machine.entries).toEqual(['./machine.js']);
  expect(layers.project?.entries).toEqual([]);
});

it('does not render a project-only ui addon listed on the machine', async () => {
  const tab = write(
    'pkg/tab.js',
    `export const scopes = ['project'];
     export const uiEntries = (acc) => [...acc, './rendered.js'];`,
  );
  const machine = write(
    'home/.bakers/machine.config.js',
    `export default { addons: [${JSON.stringify(tab)}] };`,
  );
  const warnings: string[] = [];
  const layers = await readUiEntryLayers({
    machine: { path: machine, bases: [pathToFileURL(`${tmp}/`).href] },
    logger: { warn: (_o, m) => warnings.push(m) } as never,
  });
  expect(layers.machine.entries).toEqual([]);
  expect(warnings.join('\n')).toContain('is not loaded');
});

it('names the machine config under the given home', () => {
  expect(machineUiConfigPath('/h')).toBe('/h/.bakers/machine.config.js');
});

it('finds the project config from a nested cwd', () => {
  mkdirSync(join(tmp, 'proj', '.bakers'), { recursive: true });
  writeFileSync(
    join(tmp, 'proj', '.bakers', 'project.config.js'),
    'export default {};',
  );
  mkdirSync(join(tmp, 'proj', 'src'), { recursive: true });
  expect(projectConductorConfigPath(join(tmp, 'proj', 'src'), tmp)).toBe(
    join(tmp, 'proj', '.bakers', 'project.config.js'),
  );
});

it('returns undefined when no project .bakers exists', () => {
  expect(projectConductorConfigPath(tmp, tmp)).toBeUndefined();
});

describe('machineUiConfigPath without an explicit home', () => {
  const original = process.env.BAKERS_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.BAKERS_HOME;
    else process.env.BAKERS_HOME = original;
  });

  it('resolves to the same file as machineContextPath under an overridden BAKERS_HOME', () => {
    process.env.BAKERS_HOME = join(tmp, 'relocated');
    expect(machineUiConfigPath()).toBe(machineContextPath());
    expect(machineUiConfigPath()).toBe(
      join(tmp, 'relocated', 'machine.config.js'),
    );
  });

  it('resolves to the same file as machineContextPath under the default', () => {
    delete process.env.BAKERS_HOME;
    expect(machineUiConfigPath()).toBe(machineContextPath());
    expect(machineUiConfigPath()).toBe(
      join(homedir(), '.bakers', 'machine.config.js'),
    );
  });
});
