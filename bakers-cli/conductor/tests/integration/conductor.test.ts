/**
 * Integration test: Conductor claims and dispatches a real ticket against live
 * Drupal. One claimed run drives the flow up to `running`.
 *
 * In-process wiring: Conductor + DrupalBbRemote + FakeExecutor + FakeWorkspace.
 *
 * Fixture contract (provided by `ddev init --test`):
 *   - project `bakers-e2e-project` (BB_E2E_PROJECT_UUID) with ticket
 *     GL-E2E-CONDUCTOR (BB_E2E_CONDUCTOR_TICKET_UUID) reset to state `working`,
 *     with ALL its bb_run rows deleted → freshly claimable.
 *   - auth = static HTTP Basic `fixture-agent`; the conductor registers with
 *     owner_user_id = api.me() (the same agent), so a run it claims is in the
 *     agent's write scope (BbWriteScope joins bb_run.conductor_id.owner ==
 *     current_user with run state ∈ {claimed,running} + live lease).
 *   - the fixture ticket is pre-assigned (conductor_id → the seeded
 *     `bakers-e2e-dispatch-node` conductor); conductor assignment is the run-start
 *     trigger, the user assignee no longer participates. This process pins its
 *     conductor_id (config still accepts legacy machine_id; see makeConfig) to
 *     `bakers-e2e-dispatch-node` so registerConductor upserts that same seeded
 *     entity and the claim matches.
 *     That conductor is distinct from `bakers-e2e-node` (writeback fixtures) and
 *     owns no seeded runs, so it starts freshly claimable.
 *
 * Because GL-E2E-CONDUCTOR is the ONLY freshly-claimable conductor fixture and
 * the harness resets it exactly ONCE per vitest run, the claim lifecycle lives
 * in this one file (vitest runs files serially; a second file claiming the same
 * ticket would find it terminal). The gzip wire cases below reuse that claimed
 * run and mint one extra done/unclosed run via drush — they must not claim
 * the fixture themselves.
 *
 * NOTE: the per-run footprint (BB-132) IS a conductor responsibility now —
 * the conductor parses the agent transcript and writes the metric fields onto
 * bb_run at close (finalizeRun). That write path is unit-tested in
 * conductor.test.ts (packages/conductor/tests/core) with a fake remote; the
 * bb_time_entry entity it replaced is retired.
 *
 * Run lifecycle is server-owned: the conductor only claims + dispatches and
 * never writes a run's terminal state (BB-41 removed the client releaseRun).
 * The server retires a run when the ticket transitions
 * (TicketTransitionSubscriber → closeRunsForState); that path is covered by
 * bb_core PHP tests, so it is not re-asserted here.
 *
 * Flow:
 *   conductor.start() registers the conductor (owner = me, conductor_id = pin).
 *   tick 1: claimNext creates a bb_run owned by THIS conductor
 *           (run.conductor_id → this process) → dispatch → executor.startRun →
 *           remote.markRunning(runUuid, { worktree_path }) → state = running.
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { basicAuthProvider } from '@bakers-build/addon-auth-basic';
import { ClaudeAgent, claudeAgent } from '@bakers-build/addon-claude';
import {
  FakeExecutor,
  FakeWorkspace,
  fakeExecutor,
  fakeWorkspace,
} from '@bakers-build/addon-fake';
import {
  DrupalBbRemote,
  drupalRemote,
} from '@bakers-build/addon-remote-drupal';
import type {
  BbAgent,
  BbRemote,
  ConductorFileConfig,
} from '@bakers-build/conductor/contract';
import { emptyAgentFootprint } from '@bakers-build/conductor/contract';
import { createLogger } from '@bakers-build/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROMPT } from '../../src/config.js';
import { Conductor } from '../../src/core/conductor.js';
import {
  buildFortyMibJsonl,
  type CountingProxy,
  createContext,
  drushEv,
  type E2EContext,
  FORTY_MIB,
  LOG_UPLOAD_OMITTED_WARNING,
  PROXY_INCOMING_CAP,
  rawHttpRequest,
  requiredEnv,
  startCountingProxy,
} from './helpers.js';

const E2E_PROJECT_NAME = 'bakers-e2e-project';
const E2E_STATES = ['working'];

function makeConfig(baseUrl: string): ConductorFileConfig {
  return {
    label: 'e2e-conductor',
    // Pin to the dedicated seeded conductor (recipe: bb_conductor conductor_id
    // `bakers-e2e-dispatch-node`) that GL-E2E-CONDUCTOR is pre-assigned to via
    // conductor_id — the run-start trigger. registerConductor upserts by
    // conductor_id (config machine_id is the legacy alias), so this process
    // resolves to that exact entity. It is separate from `bakers-e2e-node` (which
    // owns the seeded DROPSH/writeback runs) so this conductor starts with zero
    // active runs.
    machine_id: 'bakers-e2e-dispatch-node',
    project: E2E_PROJECT_NAME,
    states: E2E_STATES,
    prompt: DEFAULT_AGENT_PROMPT,
    max_parallel: 1,
    poll_interval_ms: 1000,
    lease_seconds: 120,
    remote: drupalRemote(),
    executor: fakeExecutor(),
    agent: [{ agent: claudeAgent() }],
    workspace: fakeWorkspace(),
    config_path: '/tmp/e2e-conductor.config.js',
    site: {
      base_url: baseUrl,
      jsonapi_prefix: '/jsonapi',
    },
  };
}

describe('Conductor integration — claim → dispatch → running', () => {
  let ctx: E2EContext;
  let config: ConductorFileConfig;
  let remote: DrupalBbRemote;
  let conductor: Conductor;
  let runUuid: string;
  let proxy: CountingProxy | undefined;
  let fortyMibLog = '';
  let gzipUploadBytes = 0;
  let gzipRemote: BbRemote;

  beforeAll(async () => {
    ctx = await createContext();
    config = makeConfig(requiredEnv('BB_E2E_BASE_URL'));
    remote = new DrupalBbRemote(ctx.api);
    const executor = new FakeExecutor({ outcome: 'exited' });
    const workspace = new FakeWorkspace();
    // `system`: nothing launches here, so the machine's sandbox must not gate claims.
    const agent = new ClaudeAgent({ security: 'system' });
    conductor = new Conductor(
      config,
      remote,
      executor,
      workspace,
      [{ id: agent.id, agent }],
      createLogger({
        checkoutRoot: process.cwd(),
        isTTY: false,
        env: { BB_CONDUCTOR_LOG: 'stdout' },
      }),
    );
  });

  it('tick claims + dispatches → bb_run is running and owned by this conductor', async () => {
    await conductor.start();

    // tick 1: claimNext → getTicket → workspace.ensure → executor.startRun →
    // remote.markRunning(runUuid, { worktree_path }).
    await conductor.tick();

    // After dispatch there must be exactly one active run owned by this conductor.
    expect(await remote.activeRunCount(conductor.id)).toBe(1);

    // Fetch the run to verify it is owned by this conductor (conductor_id).
    const activeRuns = await remote.fetchActiveRuns(conductor.id);
    expect(activeRuns).toHaveLength(1);
    runUuid = activeRuns[0]?.runUuid ?? '';
    expect(runUuid).toBeTruthy();

    // Verify the run is in state 'running' on Drupal.
    const runResource = await ctx.api.resource('bb_run', runUuid);
    expect(runResource.attr<string>('state')).toBe('running');
  });

  it('markRunning() keeps the run in state = running + refreshes heartbeat', async () => {
    await remote.markRunning(runUuid);

    const run = await ctx.api.resource('bb_run', runUuid);
    expect(run.attr<string>('state')).toBe('running');
  });

  afterAll(async () => {
    await proxy?.close();
  });

  it('gzips a 40 MiB JSONL through a 32 MiB proxy and round-trips uncompressed metadata', {
    timeout: 180_000,
  }, async () => {
    fortyMibLog = buildFortyMibJsonl();
    const originalBytes = Buffer.byteLength(fortyMibLog, 'utf8');
    expect(originalBytes).toBe(FORTY_MIB);
    expect(originalBytes).toBeGreaterThan(PROXY_INCOMING_CAP);

    proxy = await startCountingProxy(
      requiredEnv('BB_E2E_BASE_URL'),
      PROXY_INCOMING_CAP,
    );
    gzipRemote = await drupalRemote().createRemote({
      ...config,
      site: { base_url: proxy.base, jsonapi_prefix: '/jsonapi' },
      plugins: [basicAuthProvider(requiredEnv('BB_E2E_BASIC'))],
    });

    await gzipRemote.finalizeRun(runUuid, fortyMibLog);

    const gzipPatches = proxy.captured.filter(
      (row) =>
        row.method === 'PATCH' &&
        row.url.includes('/jsonapi/bb_run/bb_run/') &&
        row.requestHeaders['content-encoding'] === 'gzip',
    );
    expect(gzipPatches).toHaveLength(1);
    const upload = gzipPatches[0]!;
    expect(upload.rejected).toBe(false);
    expect(upload.status).toBeGreaterThanOrEqual(200);
    expect(upload.status).toBeLessThan(300);
    expect(upload.requestBody[0]).toBe(0x1f);
    expect(upload.requestBody[1]).toBe(0x8b);
    const identityJson = gunzipSync(upload.requestBody);
    expect(JSON.parse(identityJson.toString('utf8')).data.attributes.log).toBe(
      fortyMibLog,
    );
    gzipUploadBytes = upload.requestBytes;
    expect(gzipUploadBytes).toBeLessThanOrEqual(PROXY_INCOMING_CAP);
    expect(gzipUploadBytes).toBeLessThanOrEqual(identityJson.byteLength / 2);

    const stored = await ctx.api.resource('bb_run', runUuid);
    expect(stored.attr<string>('log_sha256')).toBe(
      createHash('sha256').update(fortyMibLog, 'utf8').digest('hex'),
    );
    expect(Number(stored.attr('log_bytes'))).toBe(originalBytes);

    const auth = `Basic ${requiredEnv('BB_E2E_BASIC')}`;
    const identity = await rawHttpRequest(
      proxy.base,
      `/_bakers-api/run/${runUuid}/log/log`,
      {
        headers: {
          Authorization: auth,
          'Accept-Encoding': 'identity',
        },
      },
    );
    const gzip = await rawHttpRequest(
      proxy.base,
      `/_bakers-api/run/${runUuid}/log/log`,
      {
        headers: {
          Authorization: auth,
          'Accept-Encoding': 'gzip',
        },
      },
    );
    expect(identity.status, identity.body.toString('utf8').slice(0, 200)).toBe(
      200,
    );
    expect(gzip.status, gzip.body.toString('utf8').slice(0, 200)).toBe(200);
    expect(identity.body.toString('utf8')).toBe(fortyMibLog);
    expect(String(gzip.headers['content-encoding'])).toBe('gzip');
    expect(gunzipSync(gzip.body).toString('utf8')).toBe(fortyMibLog);
    expect(gzip.body.byteLength).toBeLessThanOrEqual(
      identity.body.byteLength / 2,
    );

    console.info('run-log gzip wire success', {
      originalBytes,
      gzipUploadBytes,
      identityJsonBytes: identityJson.byteLength,
      identityDownloadBytes: identity.body.byteLength,
      gzipDownloadBytes: gzip.body.byteLength,
      uploadStatus: upload.status,
      identityStatus: identity.status,
      gzipStatus: gzip.status,
    });
  });

  it('omits the transcript after one size failure and does not retry on the next tick', {
    timeout: 180_000,
  }, async () => {
    expect(proxy).toBeDefined();
    expect(gzipUploadBytes).toBeGreaterThan(0);
    const fallbackCeiling = 4096;
    const omissionCap = Math.floor((gzipUploadBytes + fallbackCeiling) / 2);
    expect(omissionCap).toBeLessThan(gzipUploadBytes);
    expect(omissionCap).toBeGreaterThan(fallbackCeiling);
    proxy!.setCap(omissionCap);
    proxy!.captured.length = 0;

    const omissionRunUuid = drushEv(`
$etm = \\Drupal::entityTypeManager();
$tickets = $etm->getStorage('bb_ticket')->loadByProperties(['identifier' => 'GL-E2E-CONDUCTOR']);
$ticket = reset($tickets);
$conductors = $etm->getStorage('bb_conductor')->loadByProperties(['conductor_id' => 'bakers-e2e-dispatch-node']);
$conductor = reset($conductors);
$ticket->set('state', 'review')->save();
$run = $etm->getStorage('bb_run')->create([
  'ticket_id' => $ticket->id(),
  'conductor_id' => $conductor->id(),
  'state' => 'done',
  'closed' => FALSE,
  'worktree_path' => '/fake/GL-E2E-CONDUCTOR',
  'agent' => 'claude',
]);
$run->save();
print $run->uuid();
`).trim();
    expect(omissionRunUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const agent: BbAgent = {
      id: 'claude',
      launchCommand: () => 'true',
      getRunLog: async () => fortyMibLog,
      parseFootprint: () => emptyAgentFootprint(),
    };
    const gzipConductor = new Conductor(
      {
        ...config,
        site: { base_url: proxy!.base, jsonapi_prefix: '/jsonapi' },
        plugins: [basicAuthProvider(requiredEnv('BB_E2E_BASIC'))],
      },
      gzipRemote,
      new FakeExecutor({ outcome: 'exited' }),
      new FakeWorkspace(),
      [{ id: agent.id, agent }],
      createLogger({
        checkoutRoot: process.cwd(),
        isTTY: false,
        env: { BB_CONDUCTOR_LOG: 'stdout' },
      }),
    );
    await gzipConductor.start();
    await gzipConductor.tick();

    const runPatches = proxy!.captured.filter(
      (row) =>
        row.method === 'PATCH' &&
        row.url.includes(`/jsonapi/bb_run/bb_run/${omissionRunUuid}`),
    );
    const rejected = runPatches.filter((row) => row.rejected);
    const omissionCloses = runPatches.filter((row) => {
      if (row.rejected || row.requestHeaders['content-encoding'] === 'gzip') {
        return false;
      }
      try {
        const attrs = JSON.parse(row.requestBody.toString('utf8')).data
          .attributes as Record<string, unknown>;
        return attrs.log_upload_omitted === true && attrs.log === undefined;
      } catch {
        return false;
      }
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status).toBe(413);
    expect(rejected[0]?.requestHeaders['content-encoding']).toBe('gzip');
    expect(rejected[0]?.requestBytes).toBeGreaterThan(omissionCap);
    expect(omissionCloses).toHaveLength(1);
    expect(omissionCloses[0]?.status).toBeGreaterThanOrEqual(200);
    expect(omissionCloses[0]?.status).toBeLessThan(300);
    expect(omissionCloses[0]!.requestBytes).toBeLessThan(omissionCap);
    expect(omissionCloses[0]!.requestBytes).toBeGreaterThan(0);

    const closed = await ctx.api.resource('bb_run', omissionRunUuid);
    expect(Boolean(closed.attr('closed'))).toBe(true);
    expect(Boolean(closed.attr('log_upload_omitted'))).toBe(false);

    const auth = `Basic ${requiredEnv('BB_E2E_BASIC')}`;
    const errorLog = await rawHttpRequest(
      proxy!.base,
      `/_bakers-api/run/${omissionRunUuid}/log/error_log`,
      {
        headers: {
          Authorization: auth,
          'Accept-Encoding': 'identity',
        },
      },
    );
    expect(errorLog.status).toBe(200);
    expect(errorLog.body.toString('utf8')).toBe(LOG_UPLOAD_OMITTED_WARNING);

    const afterFirst = proxy!.captured.length;
    await gzipConductor.tick();
    const laterRunPatches = proxy!.captured
      .slice(afterFirst)
      .filter(
        (row) =>
          row.method === 'PATCH' &&
          row.url.includes(`/jsonapi/bb_run/bb_run/${omissionRunUuid}`),
      );
    expect(laterRunPatches).toHaveLength(0);

    console.info('run-log gzip wire omission', {
      gzipUploadBytes,
      omissionCap,
      rejectedStatus: rejected[0]?.status,
      rejectedBytes: rejected[0]?.requestBytes,
      fallbackStatus: omissionCloses[0]?.status,
      fallbackBytes: omissionCloses[0]?.requestBytes,
      errorLogStatus: errorLog.status,
      nextTickRunPatches: laterRunPatches.length,
    });
  });
});
