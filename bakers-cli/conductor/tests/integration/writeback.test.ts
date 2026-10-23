/**
 * Integration test: read-path verification of the seeded write-back fixtures
 * against live Drupal via the JSON:API client.
 *
 * The per-run footprint (BB-132) is written by the conductor onto bb_run
 * at close (finalizeRun), unit-tested in `conductor.test.ts`
 * (packages/conductor/tests/core) with a fake remote — not exercised here.
 * This file keeps to the READ assertions over the seeded fixtures (ticket,
 * conductor, and the active-run resolver), which prove the JSON:API auth +
 * collection/resource read path works end-to-end.
 *
 * Fixture contract (`ddev init --test`):
 *   BB_E2E_TICKET_UUID     ticket GL-E2E-DROPSH (has a run owned by the
 *                            fixture-agent's conductor)
 *   BB_E2E_CONDUCTOR_UUID  the bakers-e2e-node conductor entity
 *   BB_E2E_PROJECT_UUID    the bakers-e2e-project
 */

import { DrupalBbRemote } from '@bakers-build/addon-remote-drupal';
import { beforeAll, describe, expect, it } from 'vitest';
import { createContext, type E2EContext, requiredEnv } from './helpers.js';

/** Resolve the bb_run uuid for the given ticket uuid (any non-terminal state). */
async function runForTicket(
  ctx: E2EContext,
  ticketUuid: string,
): Promise<string> {
  const run = await ctx.api
    .collection('bb_run')
    .where('ticket_id.id', '=', ticketUuid)
    .whereIn('state', ['claimed', 'running'])
    .page(1)
    .first();
  if (!run) {
    throw new Error(`no active bb_run found for ticket ${ticketUuid}`);
  }
  return run.id;
}

describe('bakers.build write-back integration (read path over seeded fixtures)', () => {
  let ctx: E2EContext;
  let remote: DrupalBbRemote;
  let ticketUuid: string;

  beforeAll(async () => {
    ctx = await createContext();
    remote = new DrupalBbRemote(ctx.api);
    ticketUuid = requiredEnv('BB_E2E_TICKET_UUID');
  });

  it('reads the seeded ticket and conductor via api', async () => {
    const conductorUuid = requiredEnv('BB_E2E_CONDUCTOR_UUID');

    const ticket = await ctx.api.resource('bb_ticket', ticketUuid);
    const conductor = await ctx.api.resource('bb_conductor', conductorUuid);

    expect(ticket.id).toBe(ticketUuid);
    expect(conductor.id).toBe(conductorUuid);
  });

  it('reads the ticket through BbRemote.getTicket', async () => {
    const ticket = await remote.getTicket(ticketUuid);
    expect(ticket.uuid).toBe(ticketUuid);
    expect(ticket.identifier).toBe('GL-E2E-DROPSH');
  });

  it('resolves the seeded run for the DROPSH ticket via the api', async () => {
    const runUuid = await runForTicket(ctx, ticketUuid);
    expect(runUuid).toBeTruthy();

    const run = await ctx.api.resource('bb_run', runUuid);
    expect(run.rel('ticket_id')).toBe(ticketUuid);
  });
});
