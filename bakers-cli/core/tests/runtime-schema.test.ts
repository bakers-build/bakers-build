import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { assertValidConfig } from '../src/index.js';

const project = { project: { name: 'p' }, states: ['todo'] };
const machine = { machine_id: 'm', label: 'M' };

describe('runtime.read_only', () => {
  it('lists protected paths in the project config', () => {
    expect(() =>
      assertValidConfig(
        'project',
        { ...project, runtime: { read_only: ['.bakers', '.ddev', '.github'] } },
        'config',
      ),
    ).not.toThrow();
  });

  it.each([
    ['$inherit'],
    ['/etc'],
    ['../x'],
    ['a/../x'],
    [''],
    ['.'],
    ['a\\b'],
    ['C:/x'],
  ])('rejects %j', (path) => {
    expect(() =>
      assertValidConfig(
        'project',
        { ...project, runtime: { read_only: [path] } },
        'config',
      ),
    ).toThrow(/runtime/);
  });

  it('rejects an unknown runtime key and a machine-level list', () => {
    expect(() =>
      assertValidConfig('project', { ...project, runtime: { typo: [] } }, 'c'),
    ).toThrow(/runtime/);
    expect(() =>
      assertValidConfig(
        'machine',
        { ...machine, runtime: { read_only: ['.ddev'] } },
        'c',
      ),
    ).toThrow(/runtime/);
  });
});

describe('hooks.provision_exec', () => {
  it('accepts named commands and rejects anything else', () => {
    const withExec = (provision_exec: unknown) => ({
      ...project,
      hooks: { provision_exec },
    });
    expect(() =>
      assertValidConfig(
        'project',
        withExec({
          phpcs: 'bash .bakers/provision.sh exec phpcs',
          uli: { command: 'bash .bakers/provision.sh exec uli', args: true },
        }),
        'c',
      ),
    ).not.toThrow();
    for (const bad of [
      'bash x.sh',
      { drush: 1 },
      { 'bad key': 'x' },
      { uli: { command: '' } },
      { uli: { command: 'x', args: 'yes' } },
      { uli: { command: 'x', shell: true } },
    ])
      expect(() => assertValidConfig('project', withExec(bad), 'c')).toThrow(
        /provision_exec/,
      );
  });
});

it.each([
  'workspace-git',
  'herdr',
])('%s validates the shared option', (addon) => {
  const validate = new Ajv2020({ strict: false }).compile(
    JSON.parse(
      readFileSync(
        new URL(`../../addons/${addon}/options.schema.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  expect(validate({ shared: true })).toBe(true);
  expect(validate({ shared: 'yes' })).toBe(false);
});

it.each([
  'runtime-docker',
  'runtime-bwrap',
])('%s no longer takes a read_only list', (addon) => {
  const validate = new Ajv2020({ strict: false }).compile(
    JSON.parse(
      readFileSync(
        new URL(`../../addons/${addon}/options.schema.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  expect(validate({ read_only: ['.ddev'] })).toBe(false);
});
