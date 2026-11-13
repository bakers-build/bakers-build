import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimePlugin } from '@bakers-build/conductor/contract';
import { cliRootOf } from '@bakers-build/core';
import { type BwrapOptions, bwrapRuntime } from './backend.js';

export { type BwrapDeps, type BwrapOptions, bwrapRuntime } from './backend.js';

function packageOf(file: string): string {
  let dir = dirname(realpathSync(file));
  while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir)
    dir = dirname(dir);
  return dir;
}

export function runtimeBwrap(options: BwrapOptions = {}): RuntimePlugin {
  return {
    kind: 'runtime',
    id: 'bwrap',
    isolates: true,
    requiredModules: [],
    createRuntime: async () => {
      if (process.platform !== 'linux')
        throw new Error('runtime-bwrap requires Linux');
      const bwrap = (process.env.PATH ?? '')
        .split(delimiter)
        .map((dir) => join(dir, 'bwrap'))
        .find((path) => {
          try {
            accessSync(path, constants.X_OK);
            return true;
          } catch {
            return false;
          }
        });
      if (!bwrap)
        throw new Error(
          'runtime-bwrap: install bubblewrap on the conductor host',
        );
      try {
        execFileSync(
          bwrap,
          [
            '--unshare-user',
            '--unshare-pid',
            '--ro-bind',
            '/',
            '/',
            '--proc',
            '/proc',
            '--',
            '/bin/true',
          ],
          { timeout: 15000, stdio: 'pipe' },
        );
      } catch (err) {
        throw new Error(
          `runtime-bwrap: cannot create Linux namespaces; check user namespace/AppArmor policy (${String(err)})`,
        );
      }
      const home = realpathSync(homedir());
      const cliRoot = cliRootOf(
        packageOf(fileURLToPath(import.meta.url)),
        packageOf(
          fileURLToPath(
            import.meta.resolve('@bakers-build/conductor/contract'),
          ),
        ),
        home,
      );
      return bwrapRuntime(options, {
        cachePath: join(
          process.env.XDG_CACHE_HOME || join(home, '.cache'),
          'bakers/runtime-bwrap',
        ),
        cliRoot,
        env: process.env,
        bwrapPath: realpathSync(bwrap),
      });
    },
  };
}
