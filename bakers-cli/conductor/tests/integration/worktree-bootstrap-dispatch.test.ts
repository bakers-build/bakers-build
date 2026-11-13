/**
 * BB-237 layer-3 ground truth: a REAL dispatch that provisions a REAL
 * worktree with the REAL `.bakers/scripts/worktree-post.sh`, and the ordering that makes
 * the whole ticket work.
 *
 * WHAT NOTHING ELSE COVERS. `conductor/tests/core/worktree-bootstrap.test.ts`
 * runs the script standalone; `conductor/tests/core/conductor.test.ts` pins the
 * hook/layout ordering against fakes. Neither proves the two compose: that when
 * the conductor calls `openWorkspace` on a real herdr executor, the real
 * bootstrap has ALREADY finished. That is the single property this ticket
 * exists for — the `bakers ui` pane command names a binary `after_create` builds
 * — and it is asserted here by observing `existsSync(sentinel)` AT the moment
 * `openWorkspace` fires, not by checking that two calls happened in order.
 * `worktree-lifecycle.test.ts` drives a real dispatch but configures
 * `after_create: 'bash .bakers/scripts/worktree-post.sh'`, asserts nothing about the hook's
 * outcome, has no failure case, and says nothing about the pane.
 *
 * DELIBERATELY CHEAP — no Drupal control plane, no DDEV, seconds not minutes:
 *   - real `herdr` (the private daemon from `../helpers/herdr-test-server.ts`),
 *     real `HerdrWorkspace`, real `HerdrExecutor` (so the hook really runs
 *     through the production `sh -c` shell runner), real git worktree;
 *   - `@bakers-build/addon-fake`'s in-memory remote + a stub agent, so no site;
 *   - a throwaway repo carrying NO `bakers-cli/package.json`, so the script skips
 *     `pnpm install` + `pnpm -r run build` — the part that costs 20 minutes in
 *     `worktree-lifecycle.test.ts`. Everything else in the script runs for real.
 *
 * Runs wherever a `herdr` binary is on PATH and skips cleanly otherwise.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeBbRemote } from '@bakers-build/addon-fake';
import { HerdrExecutor, HerdrWorkspace } from '@bakers-build/addon-herdr';
import type {
  BbAgent,
  ConductorFileConfig,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { createLogger } from '@bakers-build/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/core/conductor.js';
import {
  herdrAvailable,
  type IsolatedHerdr,
  startIsolatedHerdr,
} from '../helpers/herdr-test-server.js';

const HAS_HERDR = herdrAvailable();

let server: IsolatedHerdr;

const SENTINEL = '.bakers/.worktree-post-done';
const LOCAL_CONFIG = '.bakers/conductor.config.local.js';
const WORKTREE_URL = 'https://bb-237-int.ddev.site';
const PARENT_URL = 'https://develop.dev.bakers.build';

/** Walks up to the repo root (the dir holding WORKFLOW.md) — the real script. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'WORKFLOW.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('WORKFLOW.md not found walking up from the test file');
}

/** The REAL bootstrap, by absolute path — this is the script under test. */
const BOOTSTRAP = join(repoRoot(), '.bakers/scripts/worktree-post.sh');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

const stubAgent: BbAgent = {
  id: 'stub',
  launchCommand: () => 'true',
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
};

function makeConfig(configPath: string): ConductorFileConfig {
  return {
    label: 'bb-237-bootstrap-dispatch',
    conductor_id: 'bb-237-int-node',
    host_key: 'bb-237-int-host',
    project: 'bb-237-int',
    states: ['working'],
    prompt: '',
    max_parallel: 1,
    poll_interval_ms: 1000,
    lease_seconds: 300,
    // Unused: the Conductor ctor is handed concrete instances.
    remote: undefined as never,
    executor: undefined as never,
    agent: undefined as never,
    workspace: undefined as never,
    config_path: configPath,
    site: { base_url: 'http://unused.invalid', jsonapi_prefix: '/jsonapi' },
  };
}

/**
 * A throwaway parent repo shaped like a bakers checkout as far as the bootstrap
 * cares: a `.bakers/conductor.config.local.js` to copy, and a committed
 * `.env.ddev` so the worktree checkout carries the URL the script resolves.
 * (In production `.env.ddev` is gitignored and written by `bash .bakers/scripts/worktree-post.sh`;
 * committing it here is what makes the resolved URL deterministic without DDEV.)
 * Carries NO `bakers-cli/package.json`, so the script skips the pnpm build.
 */
async function makeParentRepo(slug: string): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), `bb-237-${slug}-`));
  server.alsoRemove(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  await mkdir(join(repo, '.bakers'), { recursive: true });
  await writeFile(
    join(repo, LOCAL_CONFIG),
    `export default {\n  machine_id: 'parent',\n  base_url: '${PARENT_URL}',\n};\n`,
    'utf8',
  );
  await writeFile(
    join(repo, '.env.ddev'),
    `DDEV_WORKTREE_NAME=bb-237-int\nPLAYWRIGHT_BASE_URL=${WORKTREE_URL}\n`,
    'utf8',
  );
  await mkdir(join(repo, '.bakers/scripts'), { recursive: true });
  await mkdir(join(repo, '.ddev'), { recursive: true });
  await writeFile(
    join(repo, '.bakers/scripts/setup-worktree.mjs'),
    readFileSync(join(repoRoot(), '.bakers/scripts/setup-worktree.mjs')),
  );
  await writeFile(join(repo, '.ddev/config.yaml'), 'name: bakers\n');
  await writeFile(join(repo, 'README.md'), 'x\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);
  return repo;
}

/**
 * `HerdrExecutor` that records what the world looked like AT the moment the
 * conductor asked for the open layout. This is the seam the ordering assertion
 * needs: the property under test is not "both calls happened" but "the sentinel
 * already existed when the pane command was about to be launched".
 */
class ObservingExecutor extends HerdrExecutor {
  sentinelAtLayout: boolean | null = null;
  localConfigAtLayout: string | null = null;
  layoutCalls = 0;

  override async openWorkspace(
    path: string,
    ctx: { identifier: string; branch: string; title: string },
  ): Promise<void> {
    this.layoutCalls++;
    this.sentinelAtLayout = existsSync(join(path, SENTINEL));
    const cfg = join(path, LOCAL_CONFIG);
    this.localConfigAtLayout = existsSync(cfg)
      ? readFileSync(cfg, 'utf8')
      : null;
    return super.openWorkspace(path, ctx);
  }
}

interface Fixture {
  repo: string;
  executor: ObservingExecutor;
  conductor: Conductor;
  logPath: string;
  markerPath: string;
  /** UNIQUE per fixture — see {@link makeFixture}. */
  identifier: string;
  runId: number;
  runUuid: string;
  branch: string;
  /** `<identifier> · <titleSlug>` — what `startRun` labels the tab. */
  tabLabel: string;
}

/** Distinct `runId` per fixture, so no two tab labels can ever collide. */
let nextRunId = 1;

/**
 * Wire a complete real dispatch. `hook` becomes the config's `after_create`.
 * The open layout writes a marker carrying the rendered `{identifier}`, which
 * is the deterministic proof that the pane really executed its command (a PTY
 * scrape is asserted separately, as a secondary check).
 *
 * EVERY observable identity is derived from `slug` and therefore unique per
 * fixture: the ticket identifier, the run id (hence the tab label), the branch,
 * the marker token. The private daemon lives for the whole `describe`, so its
 * `tab list` / `pane list` are GLOBAL — two fixtures sharing an identifier +
 * state + run id would produce the byte-identical tab label
 * `BB-237I · working #1`, and the failure case's "the run still started"
 * assertion would then be satisfied by the SUCCESS case's leftover tab. That is
 * not hypothetical: it made this file survive an `if (!provisioning.ok) return;`
 * inserted before `startRun` — the exact regression AC-6 forbids. Uniqueness is
 * the first guard; the workspace-scoped lookups below are the second.
 */
async function makeFixture(slug: string, hook: string): Promise<Fixture> {
  const repo = await makeParentRepo(slug);
  const markerPath = join(repo, 'pane-marker.txt');
  const logDir = join(repo, '.bakers');
  const identifier = `BB-237-${slug.toUpperCase()}`;
  const runId = nextRunId++;
  const runUuid = `r-${slug}`;
  const branch = `bakers/bb-237-${slug}`;
  const state = 'working';
  const workspace = new HerdrWorkspace({ root: repo });
  const executor = new ObservingExecutor(
    {
      root: repo,
      command: 'true',
      open: {
        command: `sh -c 'echo PANE-RAN-{identifier} | tee ${markerPath}; sleep 30'`,
      },
    },
    undefined,
    // isTTY: true exercises the BB-237 default sink — pretty stdout AND the
    // durable log.txt. Asserting the failure lands in the FILE is the AC-4
    // property: before BB-237 a TTY got stdout only and the record died with
    // the pane.
    createLogger({ checkoutRoot: repo, isTTY: true, env: {} }),
  );
  const remote = new FakeBbRemote({
    tickets: {
      't-1': {
        identifier,
        title: 'bootstrap dispatch',
        state,
        branchName: branch,
      },
    },
  });
  remote.queue.push({
    runUuid,
    runId,
    ticketUuid: 't-1',
    stateAtStart: state,
    handler: 'code',
  });
  const conductor = new Conductor(
    {
      ...makeConfig(join(logDir, 'conductor.config.js')),
      hooks: { after_create: hook },
    },
    remote,
    executor,
    workspace,
    [{ id: stubAgent.id, agent: stubAgent }],
    createLogger({ checkoutRoot: repo, isTTY: true, env: {} }),
    repo,
  );
  await conductor.start();
  return {
    repo,
    executor,
    conductor,
    logPath: join(logDir, 'log.txt'),
    markerPath,
    identifier,
    runId,
    runUuid,
    branch,
    tabLabel: `${identifier} · bootstrap dispatch`,
  };
}

/**
 * The herdr workspace id of `fx`'s worktree, or null when the worktree does not
 * exist. Every observability lookup below is scoped through this: the private
 * daemon is shared by the whole `describe`, so an unscoped `tab list` /
 * `pane list` sees every fixture's artifacts.
 */
function workspaceIdOf(fx: Fixture): string | null {
  const parsed = JSON.parse(
    server.herdr(['worktree', 'list', '--cwd', fx.repo, '--json']),
  ) as {
    result?: {
      worktrees?: Array<{ branch?: string; open_workspace_id?: string }>;
    };
  };
  const entry = (parsed.result?.worktrees ?? []).find(
    (w) => w.branch?.replace(/^refs\/heads\//, '') === fx.branch,
  );
  return entry?.open_workspace_id ?? null;
}

/** Tab labels in THIS fixture's workspace only. */
function tabLabelsOf(fx: Fixture): string[] {
  const id = workspaceIdOf(fx);
  if (!id) return [];
  const parsed = JSON.parse(
    server.herdr(['tab', 'list', '--workspace', id]),
  ) as { result?: { tabs?: Array<{ label?: string }> } };
  return (parsed.result?.tabs ?? []).map((t) => t.label ?? '');
}

/**
 * The recent PTY output of the panes in THIS fixture's workspace, concatenated.
 * Scoped for the same reason as {@link tabLabelsOf}: an unscoped `pane list`
 * returns every fixture's panes, so a token from a sibling test could satisfy
 * the assertion. Safe today only because the success case happens to run first
 * — which is exactly the kind of accident this file should not rely on.
 */
function paneDump(fx: Fixture): string {
  const workspaceId = workspaceIdOf(fx);
  if (!workspaceId) return '';
  const ids = (
    JSON.stringify(
      JSON.parse(server.herdr(['pane', 'list', '--workspace', workspaceId])),
    ).match(/"pane_id":"[^"]+"/g) ?? []
  ).map((m) => m.split('"')[3] as string);
  return ids
    .map((id) => {
      try {
        // `recent-unwrapped`: the wrapped sources break a long command across
        // lines mid-path, which would defeat a substring assertion.
        return server.herdr([
          'pane',
          'read',
          id,
          '--source',
          'recent-unwrapped',
          '--lines',
          '40',
        ]);
      } catch {
        return '';
      }
    })
    .join('\n');
}

/** Poll until `check` is true or the budget runs out. */
async function waitFor(
  check: () => boolean,
  ms = 15_000,
  step = 100,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return check();
}

describe.skipIf(!HAS_HERDR)(
  'BB-237 real dispatch provisions the worktree before laying out its pane',
  () => {
    beforeAll(async () => {
      // FIRST — before any repo exists, so no `herdr … --cwd <tmp>` can precede
      // the isolation and select a throwaway repo in the developer's daemon.
      server = await startIsolatedHerdr();
    }, 60_000);

    afterAll(async () => {
      await server?.stop();
    });

    it('success: the sentinel and the rewritten base_url already exist when the pane is laid out', async () => {
      const fx = await makeFixture('ok', `bash ${BOOTSTRAP}`);

      await fx.conductor.tick();

      const wt = resolve(fx.repo, '.bakers-worktrees', fx.branch);
      expect(existsSync(wt)).toBe(true);

      // AC-1 — the real script ran to its end in a real dispatch.
      expect(existsSync(join(wt, SENTINEL))).toBe(true);
      // AC-2 — and rewrote the copied config to this worktree's own URL.
      const cfg = readFileSync(join(wt, LOCAL_CONFIG), 'utf8');
      expect(cfg).toContain(`base_url: '${WORKTREE_URL}'`);
      expect(cfg.lastIndexOf(WORKTREE_URL)).toBeGreaterThan(
        cfg.lastIndexOf(PARENT_URL),
      );

      // THE ordering property. Not "after_create then openWorkspace happened"
      // — that the bootstrap was already FINISHED when the layout fired. This is
      // what removed the need for the sentinel wait loop in the pane command.
      expect(fx.executor.layoutCalls).toBe(1);
      expect(
        fx.executor.sentinelAtLayout,
        'the sentinel must already exist when openWorkspace is called',
      ).toBe(true);
      expect(fx.executor.localConfigAtLayout).toContain(
        `base_url: '${WORKTREE_URL}'`,
      );

      // The pane really got its command, through real herdr, with {identifier}
      // rendered. The marker is written BY THE PANE'S OWN SHELL, so its
      // existence is proof the PTY executed the command — not merely that
      // `pane run` was issued.
      expect(
        await waitFor(() => existsSync(fx.markerPath)),
        'the open-layout command never ran in the pane',
      ).toBe(true);
      expect(readFileSync(fx.markerPath, 'utf8')).toContain(
        `PANE-RAN-${fx.identifier}`,
      );

      // ...and the same is visible through this workspace's own PTY buffer.
      expect(
        await waitFor(() => paneDump(fx).includes(`PANE-RAN-${fx.identifier}`)),
      ).toBe(true);
      // The run's tab exists too — dispatch got all the way to startRun.
      expect(tabLabelsOf(fx)).toContain(fx.tabLabel);
    }, 120_000);

    it('failure: a genuinely failing bootstrap still dispatches, is recorded durably, and STILL lays out the pane', async () => {
      // A real non-zero exit through the production `sh -c` runner — not a
      // stubbed reject.
      const fx = await makeFixture(
        'fail',
        'echo "bootstrap exploded" >&2; exit 3',
      );

      await expect(fx.conductor.tick()).resolves.toBeUndefined();

      const wt = resolve(fx.repo, '.bakers-worktrees', fx.branch);
      // The hook failed, so the worktree is genuinely unprovisioned.
      expect(existsSync(join(wt, SENTINEL))).toBe(false);

      // AC-6 — the run still started; a hook cannot wedge dispatch. Asserted on
      // THIS fixture's own tab label, in THIS fixture's own workspace: both are
      // unique (`BB-237-FAIL · bootstrap dispatch`), so the success case's leftover tab
      // cannot satisfy it. Mutation-checked — `if (!provisioning.ok) return;`
      // before `startRun` turns this line red.
      expect(tabLabelsOf(fx)).toContain(fx.tabLabel);

      // AC-6 + AC-4 — the failure is recorded, and it reaches the DURABLE sink
      // even though the logger was built with isTTY: true. Two records are
      // expected: the conductor's own `lifecycle hook failed` and the
      // conductor's, which attributes it to the run.
      expect(
        await waitFor(
          () =>
            existsSync(fx.logPath) &&
            readFileSync(fx.logPath, 'utf8').includes('lifecycle hook failed'),
        ),
        'the hook failure never reached the durable log',
      ).toBe(true);
      const log = readFileSync(fx.logPath, 'utf8');
      expect(log).toContain('after_create');
      expect(log).toContain('bootstrap exploded');
      // The conductor's record attributes the failure to the run + ticket.
      expect(log).toContain(fx.runUuid);
      expect(log).toContain(fx.identifier);

      // DECISION, pinned: the layout is applied ANYWAY when provisioning failed.
      // It is gated on `ws.created`, not on the hook's outcome, and that is
      // deliberate. Suppressing it would leave the operator a blank tab and no
      // signal; applying it means the pane runs the command and — in the real
      // config, where that command is `bakers ui` — surfaces the shim's loud build
      // hint. A visibly broken pane is the AC-6 behaviour ("never dispatched
      // into a broken worktree without that being visible"); a silent one is not.
      expect(fx.executor.layoutCalls).toBe(1);
      expect(fx.executor.sentinelAtLayout).toBe(false);
      expect(await waitFor(() => existsSync(fx.markerPath))).toBe(true);
      expect(
        await waitFor(() => paneDump(fx).includes(`PANE-RAN-${fx.identifier}`)),
      ).toBe(true);

      // The observability helpers are SCOPED to this fixture's workspace. This
      // asserts that directly: the success case's pane is alive in the same
      // daemon and carries its own token, and it must not leak in here. Without
      // the `--workspace` scoping this line fails — which is what makes the
      // scoping itself mutation-checkable, rather than merely asserted in prose.
      expect(paneDump(fx)).not.toContain('PANE-RAN-BB-237-OK');
    }, 120_000);
  },
);
