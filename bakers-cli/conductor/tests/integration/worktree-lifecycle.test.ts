/**
 * Full real worktree-lifecycle E2E (ticket bakers-b53f5f89 follow-up:
 * "delete still doesn't work"). Bridges the two existing integration tests:
 * conductor.test.ts drives a real dropsh ticket + run but with FAKE
 * executor/workspace; herdr-worktree-cleanup.test.ts drives a real herdr
 * worktree but with NO ticket/run. This one runs the whole chain real:
 *
 *   dropsh-minted ticket -> real claimed bb_run -> real HerdrWorkspace.ensure
 *   (git worktree off the real bakers checkout + `bash .ddev/worktree-post.sh` hook ->
 *   hardened web/sites/default) -> assert created -> ticket set done -> conductor
 *   tick -> reap -> HerdrExecutor.removeWorktree -> assert deleted.
 *
 * Runs on the HOST (herdr + ddev live there, not in the web container) behind
 * TWO INDEPENDENT gates:
 *   1. a `herdr` binary on PATH — BB-229 replaced the old `HERDR_ENV` gate;
 *      the herdr daemon this file drives is its OWN private `herdr server`
 *      (own socket + state dir, see `../helpers/herdr-test-server.ts`), so it
 *      can never pollute the developer's daemon.
 *   2. `BB_E2E_BASE_URL` — unchanged and unrelated to herdr: this suite needs
 *      a running, seeded bakers site. That gate is why this file, unlike
 *      herdr-worktree-cleanup.test.ts, is NOT CI-runnable, and isolating the
 *      daemon does not change that.
 *
 * Note the isolation boundary (BB-229 risk R4): only the herdr DAEMON is
 * private. The `after_create: bash .ddev/worktree-post.sh` hook still runs against the
 * real bakers checkout and the real DDEV project — the git worktree and the DDEV
 * stack are not isolated by this helper.
 *
 * Ticket birth + conductor_id assignment + terminal state are done via
 * `ddev drush ev`: the fixture-agent identity has neither `create bb_ticket`
 * nor `assign bakers conductor` permission, so these setup writes cannot go
 * through the API. The lifecycle (claim/dispatch/markRunning/close/teardown) is
 * all real API + real executor.
 *
 * Run it:
 *   ddev init --provider recipe-test  # seed the bb_e2e world once
 *   source .ddev/.bakers-test/env       # BB_E2E_BASE_URL + BB_E2E_BASIC
 *   # If base_url is container-internal, override to the host-reachable ddev URL:
 *   #   export BB_E2E_BASE_URL="https://<project>.ddev.site"
 *   cd bakers-cli && pnpm test:integration worktree-lifecycle
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { HerdrExecutor, HerdrWorkspace } from '@bakers-build/addon-herdr';
import { DrupalBbRemote } from '@bakers-build/addon-remote-drupal';
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
import { createContext, requiredEnv } from './helpers.js';

const HAS_ENV = herdrAvailable() && !!process.env.BB_E2E_BASE_URL;

const E2E_PROJECT = 'bakers-e2e-project';
const DISPATCH_MACHINE_ID = 'bakers-e2e-dispatch-node';

/** Run `ddev <args>` from the repo root; return stdout. */
function ddev(root: string, args: string[]): string {
  return execFileSync('ddev', args, { cwd: root, encoding: 'utf8' });
}

/** Run `git -C <cwd> <args>`; return stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

/**
 * Absolute path to THIS checkout — the one whose DDEV project carries the
 * seeded bb_e2e site, so every `ddev drush ev` below must run from here.
 */
function repoTopLevel(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Absolute path to the MAIN clone — the only `--cwd` herdr accepts for
 * `worktree create` / `worktree open`: it rejects a linked worktree outright
 * with `linked_worktree_source`, regardless of which daemon serves the call
 * (verified against a private daemon with and without a workspace open on the
 * parent repo).
 *
 * This mirrors the production anchor `deriveHerdrRoot` in
 * `@bakers-build/addon-herdr`: `--git-common-dir` resolves to the shared main `.git`
 * even from a linked worktree, and its parent is the main clone. It matters
 * here because BB-229 turned this suite's gate from `HERDR_ENV` into "a herdr
 * binary on PATH" — so it now also runs from the worktrees the conductor itself
 * works in, where `--show-toplevel` is the linked worktree and the old code
 * failed before it ever reached an assertion.
 */
function mainCloneRoot(): string {
  const commonDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  return dirname(commonDir);
}

/**
 * A unique, git-safe ticket identifier for this run.
 *
 * The terminal state goes into the identifier: the two suites in this file run
 * back to back and `Date.now()` alone could collide, which would make the second
 * suite fail on a duplicate identifier rather than on what it tests.
 */
function uniqueTicket(terminalState: string): string {
  return `E2E-WT-${terminalState.slice(0, 4).toUpperCase()}-${Date.now()}`;
}

/** No-op agent: the worktree lifecycle is under test, not a live claude run. */
const stubAgent: BbAgent = {
  id: 'stub',
  launchCommand: () => 'true',
  getRunLog: async () => '',
  parseFootprint: () => emptyAgentFootprint(),
};

/**
 * Config pinned to the seeded dispatch conductor so registerConductor upserts
 * that exact entity (owner = the calling e2e agent) and claimNext matches the
 * ticket's conductor_id. Mirrors conductor.test.ts:makeConfig but with real
 * herdr executor/workspace supplied to the Conductor ctor directly.
 */
function makeConfig(baseUrl: string): ConductorFileConfig {
  return {
    machine_id: 'e2e00000-0000-4000-8000-000000000001',
    machine_label: DISPATCH_MACHINE_ID,
    variant: 'conductor',
    project: E2E_PROJECT,
    states: ['working'],
    prompt: '',
    max_parallel: 1,
    poll_interval_ms: 1000,
    lease_seconds: 300,
    // These plugin slots are unused: the Conductor ctor gets concrete instances.
    remote: undefined as never,
    executor: undefined as never,
    agent: undefined as never,
    workspace: undefined as never,
    config_path: `${repoTopLevel()}/.bakers/conductor.config.js`,
    site: { base_url: baseUrl, jsonapi_prefix: '/jsonapi' },
  };
}

/**
 * Mint a fresh, claimable bb_ticket via drush (perm-forced: the API identity
 * cannot create a ticket or assign a conductor). Assigns it to the seeded
 * dispatch conductor + the e2e project, forces state=working, and returns its
 * uuid + derived branch_name. `Entity::set()` routes state through StateItem so
 * the working state is accepted (mirrors the bakers-init-test fixture-states step).
 */
function mintTicket(
  root: string,
  identifier: string,
): { uuid: string; branch: string } {
  const php = `
$etm = \\Drupal::entityTypeManager();
$first = static fn(array $r) => $r ? reset($r) : null;
$project = $first($etm->getStorage('bb_project')->loadByProperties(['name' => '${E2E_PROJECT}']));
$conductor = $first($etm->getStorage('bb_conductor')->loadByProperties(['label' => '${DISPATCH_MACHINE_ID}']));
if (!$project || !$conductor) { fwrite(STDERR, 'missing e2e project or dispatch conductor - run ddev init --provider recipe-test'); exit(1); }
$t = $etm->getStorage('bb_ticket')->create([
  'identifier' => '${identifier}',
  'workflow' => 'bb_work',
  'title' => 'e2e worktree lifecycle',
  'project_id' => $project->id(),
  'conductor_id' => $conductor->id(),
  'description' => ['value' => 'e2e worktree lifecycle', 'format' => 'bb_rich'],
]);
$t->set('state', 'working');
$t->save();
print json_encode(['uuid' => $t->uuid(), 'branch' => $t->get('branch_name')->value]);
`.trim();
  const out = ddev(root, ['drush', 'ev', php]).trim();
  const parsed = JSON.parse(out) as { uuid: string; branch: string };
  return parsed;
}

/** Delete the ticket + all its runs via drush (idempotent, best-effort caller). */
function dropTicket(root: string, uuid: string): void {
  const php = `
$etm = \\Drupal::entityTypeManager();
$ts = $etm->getStorage('bb_ticket');
$rows = $ts->loadByProperties(['uuid' => '${uuid}']);
if (!$rows) { print 'gone'; return; }
$t = reset($rows);
$rs = $etm->getStorage('bb_run');
$ids = $rs->getQuery()->accessCheck(FALSE)->condition('ticket_id', $t->id())->execute();
foreach ($rs->loadMultiple($ids) as $r) { $r->delete(); }
$t->delete();
print 'deleted';
`.trim();
  ddev(root, ['drush', 'ev', php]);
}

/**
 * Drive the ticket to a TERMINAL state (and retire its run) via drush.
 *
 * Entity::set() bypasses state-machine transition-edge validation (working->done
 * is not a direct API edge), matching the bakers-init-test fixture-states step.
 * Since BB-451, BbTicket::preSave() closes a terminal ticket on its own
 * save — this ->save() is what does it, `done` and `cancelled` alike — so the
 * ticket already carries `closed=1, cleaned_up=0` when this returns, which is
 * exactly what fetchUncleanedTickets now selects on (closed but not cleaned
 * up), so the next conductor.tick() runs reap() on this ticket.
 *
 * This is also the realistic path for `cancelled`, not a shortcut around one: a
 * raw state write over JSON:API/dropsh dispatches no transition event either
 * (TicketRunClosureHooks exists for exactly that gap on the run side), and
 * BbTicket::preSave() runs regardless of which event does or does not fire.
 *
 * The run is retired in both variants. Server-side a terminal transition retires
 * it (closeRunsForState); doing it here keeps the two suites comparable and
 * keeps a stale active run from steering the next tick.
 */
function markTicketTerminal(
  root: string,
  ticketUuid: string,
  runUuid: string,
  state: string,
): void {
  const php = `
$etm = \\Drupal::entityTypeManager();
$first = static fn(array $r) => $r ? reset($r) : null;
$t = $first($etm->getStorage('bb_ticket')->loadByProperties(['uuid' => '${ticketUuid}']));
$r = $first($etm->getStorage('bb_run')->loadByProperties(['uuid' => '${runUuid}']));
if ($t) { $t->set('state', '${state}')->save(); }
if ($r) { $r->set('state', 'done')->save(); }
print 'done';
`.trim();
  ddev(root, ['drush', 'ev', php]);
}

/**
 * Read the ticket's lifecycle flags straight from the server.
 *
 * Reap's whole observable effect on the ticket is `cleaned_up`/`state`, and
 * only a real read proves `cleaned_up` was actually accepted — the access
 * gate could refuse it. `closed` is read too, but it is the SERVER's doing
 * (BbTicket::preSave(), stamped by markTicketTerminal's own ->save() above)
 * rather than anything reap wrote — the point this test pins is that reap
 * leaves it alone, for `done` and `cancelled` alike.
 */
function readTicketFlags(
  root: string,
  ticketUuid: string,
): { state: string; closed: boolean; cleanedUp: boolean } {
  const php = `
$etm = \\Drupal::entityTypeManager();
$rows = $etm->getStorage('bb_ticket')->loadByProperties(['uuid' => '${ticketUuid}']);
if (!$rows) { fwrite(STDERR, 'ticket gone'); exit(1); }
$t = reset($rows);
print json_encode([
  'state' => (string) $t->get('state')->value,
  'closed' => (bool) $t->get('closed')->value,
  'cleanedUp' => (bool) $t->get('cleaned_up')->value,
]);
`.trim();
  const out = ddev(root, ['drush', 'ev', php]).trim();
  return JSON.parse(out) as {
    state: string;
    closed: boolean;
    cleanedUp: boolean;
  };
}

/**
 * The whole real lifecycle, parameterised by the TERMINAL STATE that ends it.
 *
 * Run twice — once to `done`, once to `cancelled` (BB-243). A cancelled ticket
 * used to be invisible to the reaper: `closed = 1` is written only for `done`, so
 * it matched neither branch of the work list, and its worktree, herdr workspace
 * and tabs leaked with no retry ever. Parameterising rather than copying keeps
 * both variants on ONE code path, so the cancelled case cannot quietly drift
 * into testing something the done case does not.
 *
 * Each instantiation owns its own private herdr daemon, ticket and worktree, so
 * the two are independent. That also means the cost doubles: each pass pays a
 * cold `bash .ddev/worktree-post.sh`.
 */
function terminalWorktreeLifecycle(terminalState: 'done' | 'cancelled'): void {
  describe.skipIf(!HAS_ENV)(
    `worktree lifecycle to ${terminalState} (real dropsh + herdr + ddev)`,
    () => {
      /** This suite's PRIVATE herdr daemon (never the developer's). */
      let server: IsolatedHerdr;
      /** Run `herdr <args>` against this suite's private daemon. */
      const herdr = (args: string[]): string => server.herdr(args);
      /** This checkout — the DDEV project holding the seeded site. */
      let root: string;
      /** The main clone — herdr's worktree base and its only accepted `--cwd`. */
      let herdrRoot: string;
      let identifier: string;
      let ticketUuid: string;
      let branchName: string;
      let remote: DrupalBbRemote;
      let conductor: Conductor;
      let worktreePath: string;
      let runUuid: string;

      beforeAll(async () => {
        // FIRST — before HerdrWorkspace/HerdrExecutor exist, so `ensure()`
        // creates its workspace in the private daemon and not the developer's.
        server = await startIsolatedHerdr();

        root = repoTopLevel();
        herdrRoot = mainCloneRoot();
        identifier = uniqueTicket(terminalState);
        const minted = mintTicket(root, identifier);
        ticketUuid = minted.uuid;
        branchName = minted.branch;
        const ctx = await createContext();
        remote = new DrupalBbRemote(ctx.api);
        const config = makeConfig(requiredEnv('BB_E2E_BASE_URL'));
        const logger = createLogger({
          checkoutRoot: root,
          isTTY: false,
          env: { BB_CONDUCTOR_LOG: 'stdout' },
        });
        // `herdrRoot`, not `root`: herdr's worktree base must be the main clone
        // (see mainCloneRoot) — this is the same anchor production derives.
        const workspace = new HerdrWorkspace({ root: herdrRoot });
        // Lifecycle hooks are executor-owned (BB-84): pass them + the logger to
        // the executor, not the workspace. The conductor calls executor.runHook.
        const executor = new HerdrExecutor(
          {
            root: herdrRoot,
            command: 'true',
            hooks: {
              after_create: 'bash .ddev/worktree-post.sh',
              // Keeps its name on a cancelled ticket too: renaming the hook
              // would break the `hooks` block of every conductor.config.js in
              // every checkout for a cosmetic gain.
              after_done: 'ddev delete -Oy',
            },
          },
          undefined,
          logger,
        );
        conductor = new Conductor(
          config,
          remote,
          executor,
          workspace,
          [{ id: stubAgent.id, agent: stubAgent }],
          logger,
          root,
        );
      }, 600_000);

      afterAll(async () => {
        // Best-effort, each step isolated (mirrors herdr-worktree-cleanup.test.ts).
        // A left-over Drupal-hardened worktree needs u+w restored before removal.
        try {
          if (worktreePath && existsSync(worktreePath)) {
            execFileSync('chmod', ['-R', 'u+w', worktreePath]);
          }
        } catch {
          /* ignore */
        }
        try {
          if (herdrRoot && branchName) {
            // Drop the herdr worktree if it still lists (ignore failure).
            try {
              const list = JSON.parse(
                herdr(['worktree', 'list', '--cwd', herdrRoot, '--json']),
              );
              const entry = (
                list.result.worktrees as Array<{
                  branch: string;
                  open_workspace_id?: string;
                }>
              ).find((w) => w.branch === branchName);
              if (entry?.open_workspace_id) {
                herdr([
                  'worktree',
                  'remove',
                  '--workspace',
                  entry.open_workspace_id,
                  '--force',
                  '--json',
                ]);
              }
            } catch {
              /* ignore */
            }
            git(herdrRoot, ['worktree', 'prune']);
          }
        } catch {
          /* ignore */
        }
        try {
          if (root && ticketUuid) dropTicket(root, ticketUuid);
        } catch {
          /* best-effort */
        }
        // LAST — strictly after every step above, which all still need the
        // private daemon. Guarded: a `beforeAll` that failed inside
        // `startIsolatedHerdr` never assigned `server` (it cleans up after itself).
        if (server) await server.stop();
      });

      it('mints a claimable ticket with a derived branch_name', () => {
        expect(ticketUuid).toMatch(/[0-9a-f-]{36}/);
        // branch_name is frozen server-side as feat/<identifier>-<title>, capped
        // at 30 chars (the title "e2e worktree lifecycle" slugifies into it).
        expect(branchName).toMatch(/^feat\//);
        expect(branchName.toLowerCase()).toContain('e2e');
        expect(branchName.length).toBeLessThanOrEqual(30);
      });

      it('claims a run and creates a real worktree on disk + in herdr', async () => {
        await conductor.start();
        await conductor.tick(); // claimNext -> dispatch -> ensure -> startRun -> markRunning

        const active = await remote.fetchActiveRuns(conductor.id);
        expect(active).toHaveLength(1);
        runUuid = active[0]?.runUuid ?? '';
        expect(runUuid).toBeTruthy();

        // The run carries the worktree_path (markRunning wrote it) — this is why
        // the delete path needs a run.
        worktreePath = await remote.getRunWorktree(runUuid);
        expect(worktreePath).toBeTruthy();

        // Worktree exists on disk...
        expect(existsSync(worktreePath)).toBe(true);
        // ...and herdr lists the branch.
        const list = JSON.parse(
          herdr(['worktree', 'list', '--cwd', herdrRoot, '--json']),
        );
        const branches = (
          list.result.worktrees as Array<{ branch: string }>
        ).map((w) => w.branch);
        expect(branches).toContain(branchName);
        // 20 min: dispatch runs the cold `after_create` hook (env, CLI and workspace setup).
      }, 1_200_000);

      it(`tears the worktree down on the next tick after the ticket is ${terminalState}`, async () => {
        // Sanity: the worktree exists before teardown (guards against a false
        // pass if creation silently failed).
        expect(worktreePath).toBeTruthy();
        expect(existsSync(worktreePath)).toBe(true);

        markTicketTerminal(root, ticketUuid, runUuid, terminalState);

        // The ->save() above already closed the ticket server-side (BB-451).
        // reap(): fetchUncleanedTickets -> after_done (ddev delete) ->
        // executor.removeWorktree(branch, worktreePath) -> markTicketCleanedUp.
        await conductor.tick();

        // THE assertion this whole test exists for: the worktree is gone on disk...
        expect(existsSync(worktreePath)).toBe(false);
        // ...and herdr no longer lists the branch...
        const list = JSON.parse(
          herdr(['worktree', 'list', '--cwd', herdrRoot, '--json']),
        );
        const branches = (
          list.result.worktrees as Array<{ branch: string }>
        ).map((w) => w.branch);
        expect(branches).not.toContain(branchName);
        // ...and git worktree metadata is pruned.
        const gitList = git(herdrRoot, ['worktree', 'list']);
        expect(gitList).not.toContain(worktreePath);
      }, 600_000);

      it(`flags cleaned_up and leaves a ${terminalState} ticket's state alone`, () => {
        // Read the real server, not the client's view: this is what proves the
        // access gate actually ACCEPTED the cleaned_up write — the grant is
        // `cleaned_up` alone on any terminal ticket now (BB-451), `done` and
        // `cancelled` treated identically.
        const flags = readTicketFlags(root, ticketUuid);

        expect(flags.cleanedUp).toBe(true);
        // Reaping never moves the state — for `cancelled` that is the whole
        // point: it must not be promoted to `done`.
        expect(flags.state).toBe(terminalState);
        // `closed` is the server's own doing (BbTicket::preSave()) on ANY
        // terminal state, done and cancelled alike — reap has no ability to
        // write it either way, so this pins that it is left exactly as the
        // save above produced it.
        expect(flags.closed).toBe(true);
      });
    },
  );
}

terminalWorktreeLifecycle('done');
terminalWorktreeLifecycle('cancelled');
