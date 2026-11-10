import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspacePlugin } from '@bakers-build/addon-workspace';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  bakersProjectOwner,
  readBbProjectSelection,
  writeBbWorkspaceSelection,
} from '../../conductor/src/cli/project-context.js';
import {
  firstWorkspace,
  secondWorkspace,
  workspaceFixture,
} from '../../core/tests/fixtures/workspace-server.js';
import { cmdUi } from '../src/ui.js';

function hostWithProjectContext(configPath?: string) {
  return {
    resolveBases: [],
    workspacePlugin: (workspaceId: string) =>
      workspacePlugin({ workspace_id: workspaceId }),
    projectContext: {
      resolveConfigPath: () =>
        configPath ?? join(f.root, '.bakers/project.config.js'),
      readWorkspace: (path: string) => readBbProjectSelection(path).workspace,
      writeWorkspace: async (configPath: string, name: string) => {
        await writeBbWorkspaceSelection(
          bakersProjectOwner(configPath),
          name,
          `Set project.workspace in ${configPath} to switch manually.`,
        );
      },
    },
  };
}

let f: Awaited<ReturnType<typeof workspaceFixture>>;
beforeEach(async () => {
  f = await workspaceFixture();
  await f.login();
});
it('reads and updates the selected conductor variant', async () => {
  const defaultConductor = join(f.root, '.bakers/project.config.js');
  const variantConductor = join(f.root, '.bakers/project.night.config.js');
  writeFileSync(
    defaultConductor,
    "export default { project: { name: 'default', workspace: 'First' } };\n",
  );
  writeFileSync(
    variantConductor,
    "export default { project: { name: 'night', workspace: 'Second' } };\n",
  );

  await cmdUi({
    host: hostWithProjectContext(variantConductor),
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: () => {},
    runUi: async (opts) => {
      expect(opts.workspaceId).toBe(secondWorkspace);
      await opts.selectWorkspace?.('First');
    },
  });

  expect(readFileSync(variantConductor, 'utf8')).toContain(
    'workspace: "First"',
  );
  expect(readFileSync(defaultConductor, 'utf8')).toContain(
    "workspace: 'First'",
  );
});
it('uses committed project.workspace without consuming the worktree plugin slot', async () => {
  const conductor = join(f.root, '.bakers/project.config.js');
  writeFileSync(
    conductor,
    `export default { project: { name: 'demo', workspace: 'Second' }, worktree: { use: '@bakers-build/addon-herdr', export: 'herdrWorkspace' } };\n`,
  );
  writeFileSync(f.config, f.source(firstWorkspace));

  await cmdUi({
    host: hostWithProjectContext(),
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: () => {},
    runUi: async (opts) => {
      expect(opts.connection.authPlugins[1]?.id).toBe(
        `selected-${secondWorkspace}`,
      );
      await opts.selectWorkspace?.('First');
    },
  });

  const written = readFileSync(conductor, 'utf8');
  expect(written).toContain('workspace: "First"');
  expect(written).toContain("worktree: { use: '@bakers-build/addon-herdr'");
});
it('derives UI workspace from the unique committed project when no workspace is named', async () => {
  const conductor = join(f.root, '.bakers/project.config.js');
  writeFileSync(conductor, `export default { project: { name: 'demo' } };\n`);
  writeFileSync(f.config, f.source(firstWorkspace));
  const base = hostWithProjectContext();
  const resolveContext = vi.fn(
    async (_path: string, connection: { workspace_id?: string }) => {
      expect(connection.workspace_id).toBeUndefined();
      return {
        projectId: 'demo-id',
        workspaceId: secondWorkspace,
        workspace: 'Second',
      };
    },
  );
  await cmdUi({
    host: {
      ...base,
      projectContext: { ...base.projectContext, resolveContext },
    },
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: () => {},
    runUi: async (opts) => {
      expect(opts.workspaceId).toBe(secondWorkspace);
    },
  });
  expect(resolveContext).toHaveBeenCalledOnce();
  expect(readFileSync(conductor, 'utf8')).toBe(
    `export default { project: { name: 'demo' } };\n`,
  );
});
it('prints connection configuration without an online project lookup', async () => {
  const conductor = join(f.root, '.bakers/project.config.js');
  writeFileSync(conductor, `export default { project: { name: 'demo' } };\n`);
  const base = hostWithProjectContext();
  const resolveContext = vi.fn(async () => {
    throw new Error('online project lookup must not run');
  });
  const stdout = vi.fn();
  await cmdUi({
    host: {
      ...base,
      projectContext: { ...base.projectContext, resolveContext },
    },
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: { stateDir: f.stateDir },
    printConfig: true,
    stdout,
    stderr: () => {},
  });
  expect(resolveContext).not.toHaveBeenCalled();
  expect(stdout).toHaveBeenCalled();
});
afterEach(async () => {
  process.exitCode = 0;
  await f.close();
});
// BB-495 F8: `loadReadyBbConnection` no longer prompts or writes a
// workspace selection back to disk — that recovery flow, and the requirement
// it existed to satisfy, are both gone. A connection still names its own
// workspace explicitly (here computed from a module it imports; the retired
// conductor.config.local.js is not that module any more, BAKERS-159), and the UI still attaches its own
// `workspacePlugin` for whatever value it resolves.
it('picks up a workspace the connection computes from an imported module, without any prompt', async () => {
  const local = join(f.root, '.bakers/workspace.local.js');
  writeFileSync(
    local,
    `export default {workspace_id:${JSON.stringify(secondWorkspace)}};`,
  );
  writeFileSync(
    f.config,
    `import local from './workspace.local.js';export default {site:{base_url:'${f.base}'},workspace_id:local.workspace_id,plugins:${f.plugins}};`,
  );
  let rendered = false;
  let error = '';
  await cmdUi({
    host: { resolveBases: [] },
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: (s) => (error += s),
    runUi: async (opts) => {
      rendered = true;
      expect(opts.connection.authPlugins[1]?.id).toBe(
        `selected-${secondWorkspace}`,
      );
      expect(opts.writeClient).toBeDefined();
      const stdout = process.stdout.write;
      try {
        process.stdout.write = (() => true) as typeof stdout;
        await opts
          .buildProgram({ plugins: opts.connection.authPlugins })
          .parseAsync(['search', 'bb_workspace', '--bundle', 'bb_workspace'], {
            from: 'user',
          });
      } finally {
        process.stdout.write = stdout;
      }
      expect(f.workspaces.at(-1)).toBe(secondWorkspace);
    },
  });
  expect(error).toBe('');
  expect(rendered).toBe(true);
});
// BB-495 D2: `workspace_id` is optional for `bakers ui` too — a config naming
// none still starts the renderer; the cockpit's own picker screen is how a
// workspace gets chosen afterwards (BB-472), not a startup refusal.
it('starts the renderer even with no workspace configured, during automation', async () => {
  let rendered = false;
  let error = '';
  await cmdUi({
    host: { resolveBases: [] },
    cwd: f.root,
    explicitConfig: f.config,
    workspaceRecovery: {
      interactive: true,
      ci: false,
      yes: true,
      stateDir: f.stateDir,
    },
    updateCheck: async () => null,
    stderr: (s) => (error += s),
    runUi: async (opts) => {
      rendered = true;
      expect(opts.connection.authPlugins.map((p) => p.id)).not.toContain(
        'bakers-workspace',
      );
    },
  });
  expect(error).toBe('');
  expect(rendered).toBe(true);
  // The token and the signed-in identity (`api.me()`, the current user) —
  // no workspace discovery.
  expect(f.requests).toEqual([
    'POST /oauth/token undefined',
    'GET /jsonapi/ Bearer fixture-token',
  ]);
});

// BB-472: `--workspace` selects at startup, for this process only.
it('--workspace selects the named workspace for this run, without writing it to the config', async () => {
  const before = readFileSync(f.config, 'utf8');
  let rendered = false;
  let error = '';
  await cmdUi({
    host: { resolveBases: [] },
    cwd: f.root,
    explicitConfig: f.config,
    workspace: 'Second',
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: (s) => (error += s),
    runUi: async (opts) => {
      rendered = true;
      expect(opts.connection.authPlugins[1]?.id).toBe(
        `selected-${secondWorkspace}`,
      );
    },
  });
  expect(error).toBe('');
  expect(rendered).toBe(true);
  expect(readFileSync(f.config, 'utf8')).toBe(before);
});

it('--workspace with an unknown name fails before the renderer starts', async () => {
  let rendered = false;
  let error = '';
  await cmdUi({
    host: { resolveBases: [] },
    cwd: f.root,
    explicitConfig: f.config,
    workspace: 'nope',
    workspaceRecovery: { stateDir: f.stateDir },
    updateCheck: async () => null,
    stderr: (s) => (error += s),
    runUi: async () => {
      rendered = true;
    },
  });
  expect(rendered).toBe(false);
  expect(error).toContain('nope');
});
