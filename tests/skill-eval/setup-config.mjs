// Execute the real config command with private state and no authenticated transport.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { registerConfig } from '../../bakers-cli/host/src/config.ts';

const require = createRequire(new URL('../../bakers-cli/host/package.json', import.meta.url));
const { Command } = require('commander');
const root = resolve(process.argv[2]);
process.env.BAKERS_HOME = resolve(root, 'machine');
globalThis.fetch = async () => { throw new Error('Live network is disabled in setup audit'); };
const program = new Command().exitOverride();
registerConfig(program, {
  cwd: resolve(root, 'project'), stateDir: resolve(root, 'auth-state'),
  isTTY: false, env: { BAKERS_HOME: process.env.BAKERS_HOME, CI: '1' },
});
try {
  await program.parseAsync(['node', 'bakers', ...JSON.parse(process.argv[3])]);
} catch (error) {
  if (error.code !== 'commander.helpDisplayed') {
    console.error(error.message);
    process.exitCode = 1;
  }
}
