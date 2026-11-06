import { DrupalBbRemote } from '@bakers-build/addon-remote-drupal';
import { readBbProjectSelection } from '@bakers-build/conductor/project-context';
import {
  type BbCommandHost,
  type BbCommandPlugin,
  createBbConnectionClient,
  exec,
  loadBbConfig,
  normalizeRepoUrl,
  resolveConfigPath,
} from '@bakers-build/core';
import type { Command } from 'commander';
import { registerDeployment } from './deployment.js';

// `deployment` is its own COMMAND-surface addon. The batch gathering
// (`src/deployment.ts`) takes the remote, the project and the cwd as thunks.
// It needs only the connection (`bakers.config.js`) and a project name, never
// the conductor engine config: loading that one validates conductor identity,
// agents and addons. So a machine that is not set up as a conductor, or has an
// older config, could not compute a release batch.
//
// The host mounts this module lazily (the `./preset` accumulator is what
// `bakers --help` reads), so its imports are paid only on dispatch.

type Client = Awaited<ReturnType<typeof createBbConnectionClient>>;

/**
 * The project the identifiers belong to: `--project`, else the committed
 * `bakers.project` (read statically, never imported), else the one project
 * whose `repository` is the cwd's `origin` remote.
 */
async function resolveProject(
  client: () => Promise<Client>,
  cwd: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) return explicit;
  try {
    return readBbProjectSelection(resolveConfigPath(undefined, cwd)).project;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const origin = normalizeRepoUrl(
    await exec('git', ['remote', 'get-url', 'origin'], { cwd }).catch(
      () => undefined,
    ),
  );
  // JSON:API cannot filter inside the `repository` field, so match client-side.
  // shortcut: only the first 200 projects are searched (as `bakers ui --here`), paginate when a connection reads more.
  const rows = origin
    ? await (await client())
        .collection('bb_project')
        .fields(['name', 'repository'])
        .page(200)
        .list()
    : [];
  const names = rows
    .filter((row) =>
      [row.attr<unknown>('repository')]
        .flat()
        .some(
          (repo) =>
            normalizeRepoUrl((repo as { url?: unknown } | null)?.url) ===
            origin,
        ),
    )
    .map((row) => row.attr<string>('name') ?? '');
  if (names.length === 1) return names[0] as string;
  throw new Error(
    names.length === 0
      ? `no bakers project owns the origin remote${origin ? ` ${origin}` : ''} and no .bakers/conductor.config.js names one; pass --project <name>`
      : `several bakers projects own the origin remote ${origin} (${names.join(', ')}); pass --project <name>`,
  );
}

/** The `deployment` command plugin the host mounts (`bakers deployment …`). */
const deploymentCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'deployment',
  describe: 'release / deployment helpers',
  register(program: Command, host: BbCommandHost): void {
    let connected: Promise<Client> | undefined;
    const client = () => {
      connected ??= loadBbConfig(host, {}).then((connection) =>
        createBbConnectionClient(connection),
      );
      return connected;
    };
    registerDeployment(
      program,
      async () => new DrupalBbRemote(await client()),
      (explicit) => resolveProject(client, process.cwd(), explicit),
      () => process.cwd(),
    );
  },
};

export default deploymentCommandPlugin;
export {
  type GatherResult,
  gatherBatch,
  parseIdentifiers,
  registerDeployment,
} from './deployment.js';
