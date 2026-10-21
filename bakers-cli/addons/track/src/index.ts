import {
  createBbConnectionClient,
  type BbCommandPlugin,
  loadReadyBbConnection,
} from '@bakers-build/core';
import type { Command } from 'commander';
import { loadEvidence } from './evidence.js';

type Options = {
  from: string;
  to: string;
  timezone?: string;
  config?: string;
  connection?: string;
};

export function registerTrack(
  program: Command,
  read: (options: Options) => Promise<unknown>,
): void {
  program
    .command('track')
    .description('Personal time evidence')
    .command('evidence')
    .description('Read daily runs, activities and existing time as JSON')
    .requiredOption('--from <date>', 'first civil date (YYYY-MM-DD)')
    .requiredOption('--to <date>', 'last civil date (YYYY-MM-DD), inclusive')
    .option(
      '--timezone <zone>',
      'IANA timezone; defaults to the employee profile',
    )
    .option('--config <path>', 'connection config path')
    .option('--connection <id>', 'named connection')
    .action(async (options: Options) => {
      const report = await read(options);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });
}

const trackCommand: BbCommandPlugin = {
  kind: 'command',
  name: 'track',
  describe: 'read personal daily evidence for time preparation',
  register(program, host) {
    registerTrack(program, async (options) => {
      const connection = await loadReadyBbConnection(host, {
        ...(options.config ? { explicit: options.config } : {}),
        ...(options.connection ? { connection: options.connection } : {}),
      });
      const client = await createBbConnectionClient(connection);
      const worklogs = await createBbConnectionClient({
        ...connection,
        site: { ...connection.site, jsonapi_prefix: '/api/time' },
      });
      return loadEvidence(client, options, worklogs);
    });
  },
};
export default trackCommand;
