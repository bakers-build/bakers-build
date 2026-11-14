import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimePlugin } from '@bakers-build/conductor/contract';
import { cliRootOf } from '@bakers-build/core';
import {
  dockerRuntime,
  type RuntimeDockerOptions,
  realExec,
  shortHash,
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
  return { cliRoot: cliRootOf(packageDir, conductor, homedir()), packageDir };
}

export { cliRootOf } from '@bakers-build/core';

/** The shipped image's tag: the package version plus a hash of `image/`, so any change rebuilds it. */
export function imageVersion(packageDir: string, version: string): string {
  const dir = join(packageDir, 'image');
  const files = readdirSync(dir).sort();
  return `${version}-${shortHash(files.map((f) => f + readFileSync(join(dir, f), 'utf8')).join('\0'))}`;
}

export function runtimeDocker(
  options: RuntimeDockerOptions = {},
): RuntimePlugin {
  return {
    kind: 'runtime',
    id: 'docker',
    isolates: true,
    ...(options.shared !== undefined ? { shared: options.shared } : {}),
    requiredModules: [],
    createRuntime: async (config, { logger }) => {
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
        version: imageVersion(packageDir, version),
        conductorKey: shortHash(config.config_path),
        ...(process.argv[1]
          ? { bakersEntry: realpathSync(process.argv[1]) }
          : {}),
      });
    },
  };
}
