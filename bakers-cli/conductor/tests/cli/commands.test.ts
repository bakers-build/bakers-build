import { expect, it } from 'vitest';
import { buildConductorProgram } from '../../src/commands/conductor.js';

function quietProgram() {
  const program = buildConductorProgram().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  for (const command of program.commands)
    command.exitOverride().configureOutput({ writeErr: () => {} });
  return program;
}

it('mounts the oven group with start, once, check, clean, stop, ls and status', () => {
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
