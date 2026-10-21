import { expect, it } from 'vitest';
import { buildConductorProgram } from '../../src/commands/conductor.js';

it('removed conductor init is an ordinary unknown subcommand before configuration loading', async () => {
  const program = buildConductorProgram().exitOverride();
  program.configureOutput({ writeErr: () => {} });
  for (const command of program.commands)
    command.exitOverride().configureOutput({ writeErr: () => {} });
  await expect(
    program.parseAsync(['conductor', 'init'], { from: 'user' }),
  ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
});
