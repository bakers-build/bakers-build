import type { BbCommandPlugin } from '@bakers-build/core';
import { resolveBbInfo } from './info.js';

const infoCommand: BbCommandPlugin = {
  kind: 'command',
  name: 'info',
  describe: 'print the resolved project and workspace context as JSON',
  register(program, host) {
    program
      .command('info')
      .description(
        'Print the resolved project and workspace context (BB-495) as JSON',
      )
      .option('--config <path>', 'connection config path')
      .option('--connection <id>', 'named connection from ~/.bakers/connections')
      .action(async (options: { config?: string; connection?: string }) => {
        const result = await resolveBbInfo({
          host,
          ...(options.config !== undefined
            ? { explicitConfig: options.config }
            : {}),
          ...(options.connection !== undefined
            ? { connection: options.connection }
            : {}),
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      });
  },
};
export default infoCommand;
export type { BbInfoResult, ResolveBbInfoOptions } from './info.js';
export { resolveBbInfo } from './info.js';
