import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeBbRemote,
  FakeExecutor,
  FakeWorkspace,
} from '@bakers-build/addon-fake';
import type { ConductorFileConfig } from '@bakers-build/conductor/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BbCliDeps,
  buildConductorProgram,
} from '../../src/commands/conductor.js';

function quietProgram() {
  const program = buildConductorProgram().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  for (const command of program.commands)
    command.exitOverride().configureOutput({ writeErr: () => {} });
  return program;
}

it('mounts the oven group with start, once, check, clean, stop, ls, status and tools', () => {
  const oven = buildConductorProgram().commands.find(
    (c) => c.name() === 'oven',
  );
  expect(oven?.commands.map((c) => c.name()).sort()).toEqual([
    'check',
    'clean',
    'ls',
    'once',
    'start',
    'status',
    'stop',
    'tools',
  ]);
  expect(oven?.options.map((o) => o.long)).toEqual([
    '--log-level',
    '--log-sink',
  ]);
});

it.each([
  ['conductor'],
  ['bake'],
])('`%s` is an unknown command', async (name) => {
  await expect(
    quietProgram().parseAsync([name, 'start'], { from: 'user' }),
  ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
});

it('removed oven init, poll and reap are ordinary unknown subcommands before configuration loading', async () => {
  for (const sub of ['init', 'poll', 'reap'])
    await expect(
      quietProgram().parseAsync(['oven', sub], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
});

describe('oven start --dry-run', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  async function dryRun(deps: BbCliDeps): Promise<string[]> {
    const errors: string[] = [];
    const err = vi.spyOn(console, 'error').mockImplementation((m) => {
      errors.push(String(m));
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await buildConductorProgram(deps).parseAsync(
        ['oven', 'start', '--dry-run'],
        {
          from: 'user',
        },
      );
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
    return errors;
  }

  it('exits 0 on a config that loads, without registering a conductor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-dry-run-'));
    vi.stubEnv('BB_CONDUCTOR_LOG', 'file');
    const remote = new FakeBbRemote();
    const register = vi.spyOn(remote, 'registerConductor');

    await dryRun({
      remote,
      config: {
        config_path: join(dir, 'conductor.config.js'),
      } as ConductorFileConfig,
      executor: new FakeExecutor({ outcome: 'exited' }),
      workspace: new FakeWorkspace(),
      agents: [],
    });

    expect(process.exitCode ?? 0).toBe(0);
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a syntax error',
      "export default { bakers: { project: 'bakers' }, oops: };",
      /bakers\.project/,
    ],
    [
      'a throwing import',
      "const t = typo.value;\nexport default { bakers: { project: 'bakers' } };",
      /typo is not defined/,
    ],
  ])('exits 1 naming the error on a config with %s', async (_name, body, error) => {
    const dir = mkdtempSync(join(tmpdir(), 'bakers-dry-run-'));
    const file = join(dir, 'conductor.config.js');
    writeFileSync(file, body);
    vi.stubEnv('BB_CONDUCTOR_CONFIG', file);

    const errors = await dryRun({});

    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(error);
  });
});
