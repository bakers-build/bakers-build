import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as loader from '../../src/cli/load-bakers-config.js';
import * as recovery from '../../src/cli/workspace-recovery.js';
import {
  firstWorkspace,
  secondWorkspace,
  workspaceFixture,
} from '../fixtures/workspace-server.js';

let f: Awaited<ReturnType<typeof workspaceFixture>>;
const host = { resolveBases: [] };
beforeEach(async () => {
  f = await workspaceFixture();
  await f.login();
});
afterEach(async () => {
  await f.close();
});

it('loads configured authentication without inventing a workspace during bootstrap', async () => {
  const c = await loader.loadBbConnectionBootstrap(host, {
    explicit: f.config,
  });
  expect(c.workspace_id).toBeUndefined();
  expect(c.plugins.length).toBe(2);
  // BB-495: workspace_id is optional now — loadBbConfig loads the same
  // connection rather than rejecting it.
  const ready = await loader.loadBbConfig(host, { explicit: f.config });
  expect(ready.workspace_id).toBeUndefined();
});

// BB-495 F8: `loadReadyBbConnection` used to own workspace recovery —
// refusing a keyless config, then prompting and writing a selection back to
// disk. That is exactly the behaviour spec D3 introduced `bakers info` to
// replace, and it is why `bakers dropsh` kept refusing AC7's keyless config
// three review rounds after the throw was removed from `loadBbConfig`
// itself. It is now a thin pass-through to the bootstrap load: no throw, no
// prompt, no write.
describe('loadReadyBbConnection (BB-495 F8)', () => {
  it('loads a connection that names no workspace, on the very path bakers dropsh calls', async () => {
    const connection = await recovery.loadReadyBbConnection(host, {
      explicit: f.config,
      stateDir: f.stateDir,
    });
    expect(connection.workspace_id).toBeUndefined();
    expect(connection.site.base_url).toBe(f.base);
  });

  it('never prompts and never writes to the config file', async () => {
    const before = readFileSync(f.config, 'utf8');
    await recovery.loadReadyBbConnection(host, {
      explicit: f.config,
      stateDir: f.stateDir,
      prompt: async () => {
        throw new Error('prompt must not run');
      },
    });
    expect(readFileSync(f.config, 'utf8')).toBe(before);
  });

  it('still honors a one-shot --workspace override, never persisted', async () => {
    const connection = await recovery.loadReadyBbConnection(host, {
      explicit: f.config,
      stateDir: f.stateDir,
      workspaceIdOverride: firstWorkspace,
    });
    expect(connection.workspace_id).toBe(firstWorkspace);
    expect(connection.plugins[1]?.id).toBe(`selected-${firstWorkspace}`);
    expect(readFileSync(f.config, 'utf8')).not.toContain(firstWorkspace);
  });

  it('resolves the committed workspace name through the reachable workspace list', async () => {
    const scopedHost = {
      resolveBases: [],
      workspacePlugin: (workspaceId: string) => ({
        id: `ambient-${workspaceId}`,
      }),
    };
    const connection = await recovery.loadReadyBbConnection(host, {
      cwd: f.root,
      explicit: f.config,
      stateDir: f.stateDir,
      workspaceSelector: 'Second',
    });

    expect(connection.workspace_id).toBe(secondWorkspace);
    expect(connection.plugins[1]?.id).toBe(`selected-${secondWorkspace}`);
    const scoped = await recovery.loadReadyBbConnection(scopedHost, {
      cwd: f.root,
      explicit: f.config,
      stateDir: f.stateDir,
      workspaceSelector: 'Second',
    });
    expect(scoped.plugins.map((plugin) => plugin.id)).toContain(
      `ambient-${secondWorkspace}`,
    );
  });

  it('lets the committed workspace name override a legacy connection workspace UUID', async () => {
    writeFileSync(f.config, f.source(firstWorkspace));
    const connection = await recovery.loadReadyBbConnection(host, {
      cwd: f.root,
      explicit: f.config,
      stateDir: f.stateDir,
      workspaceSelector: 'Second',
    });

    expect(connection.workspace_id).toBe(secondWorkspace);
    expect(connection.plugins[1]?.id).toBe(`selected-${secondWorkspace}`);
  });
});

it('teaches the named workspace tool as the recovery command', () => {
  expect(recovery.workspaceSearchCommand("/x/it's.js")).toBe(
    `bakers tools --config '/x/it'\\''s.js' tool_api__bakers_workspace_list`,
  );
});

describe('resolveWorkspaceSelector', () => {
  const choices = [
    { id: 'aaaa-1', name: 'keytec' },
    { id: 'bbbb-2', name: 'acme' },
  ];

  it('accepts a uuid', () => {
    expect(recovery.resolveWorkspaceSelector(choices, 'aaaa-1')).toBe('aaaa-1');
  });

  it('accepts a name', () => {
    expect(recovery.resolveWorkspaceSelector(choices, 'acme')).toBe('bbbb-2');
  });

  it('refuses an unknown selector, naming what is reachable', () => {
    expect(() => recovery.resolveWorkspaceSelector(choices, 'nope')).toThrow(
      /keytec, acme/,
    );
  });

  it('refuses an ambiguous name rather than guessing', () => {
    const dupes = [
      { id: 'aaaa-1', name: 'keytec' },
      { id: 'bbbb-2', name: 'keytec' },
    ];
    expect(() => recovery.resolveWorkspaceSelector(dupes, 'keytec')).toThrow(
      /ambiguous/i,
    );
  });

  // Models the BB-472 manual fixture (recipes/bb_e2e/content/): `both-bakeries`
  // reaches exactly these two workspaces ('Northside Bakery' and
  // 'Southside Bakery'), while `south-contributor` reaches only 'Southside Bakery'. A raw
  // uuid selector is accepted here unconditionally (line 59 above) — actual
  // membership is enforced server-side by the JSON:API request that follows —
  // so the boundary this pure function DOES enforce, and the one the manual
  // switch test relies on for a NAME selector, is refusing a name that is not
  // among the identity's own reachable choices. `south-contributor` selecting the
  // default workspace by its name ('Northside Bakery') is exactly that case: the name is
  // only ever offered to `both-bakeries`, never to `south-contributor`.
  it('refuses a workspace name the identity is not a member of, naming only the reachable ones', () => {
    // What `south-contributor` actually reaches: 'Southside Bakery' only.
    const otherMemberChoices = [
      { id: 'dbc60000-0000-4000-8000-000000000002', name: 'Southside Bakery' },
    ];
    // The default workspace's name — reachable by `both-bakeries`, not by
    // `south-contributor` — selected as a name rather than a uuid.
    const foreignWorkspaceName = 'Northside Bakery';

    expect(() =>
      recovery.resolveWorkspaceSelector(
        otherMemberChoices,
        foreignWorkspaceName,
      ),
    ).toThrow(/Southside Bakery/);
  });
});
