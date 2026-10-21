import { loadConductorConfig } from '@bakers-build/conductor';
import { type BbCommandPlugin, resolveConfigPath } from '@bakers-build/core';
import { agentReport } from './agents.js';

const agentsCommand: BbCommandPlugin = {
  kind: 'command',
  name: 'agents',
  describe: 'print the locally resolved agent catalog as JSON',
  register(program) {
    program
      .command('agents')
      .description('Print available aliases and machine defaults as JSON')
      .option('--config <path>', 'conductor config path')
      .action(async (options: { config?: string }) => {
        const config = await loadConductorConfig(
          resolveConfigPath(options.config),
        );
        process.stdout.write(
          `${JSON.stringify(agentReport(config), null, 2)}\n`,
        );
      });
  },
};
export default agentsCommand;
export { agentReport } from './agents.js';
