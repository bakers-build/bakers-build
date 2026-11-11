import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimePlugin } from '@bakers-build/conductor/contract';
import {
  dockerRuntime,
  type RuntimeDockerOptions,
  realExec,
} from './backend.js';

export * from './args.js';
export {
  type BackendDeps,
  dockerRuntime,
  type RuntimeDockerOptions,
} from './backend.js';

/** The nearest directory at or above `file` holding a package.json. */
function packageOf(file: string): string {
  let dir = dirname(realpathSync(file));
  while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir)
    dir = dirname(dir);
  return dir;
}

/**
 * This package's directory, and the CLI build a run mounts read-only: the
 * common ancestor of this package and the conductor, widened to the outermost
 * `node_modules` of an installed CLI so its hoisted dependencies come along.
 */
export function pluginPaths(): { cliRoot: string; packageDir: string } {
  const packageDir = packageOf(fileURLToPath(import.meta.url));
  const conductor = packageOf(
    fileURLToPath(import.meta.resolve('@bakers-build/conductor/contract')),
  );
  const a = packageDir.split(sep);
  const b = conductor.split(sep);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let cliRoot = a.slice(0, i).join(sep) || sep;
  const nm = cliRoot.indexOf(`${sep}node_modules`);
  if (nm >= 0) cliRoot = cliRoot.slice(0, nm + `${sep}node_modules`.length);
  return { cliRoot, packageDir };
}

export function runtimeDocker(
  options: RuntimeDockerOptions = {},
): RuntimePlugin {
  return {
    kind: 'runtime',
    id: 'docker',
    isolates: true,
    requiredModules: [],
    createRuntime: async (_config, { logger }) => {
      const { cliRoot, packageDir } = pluginPaths();
      const { version } = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf8'),
      ) as { version: string };
      return dockerRuntime(options, {
        exec: realExec,
        env: process.env,
        logger,
        cliRoot,
        packageDir,
        version,
      });
    },
  };
}
