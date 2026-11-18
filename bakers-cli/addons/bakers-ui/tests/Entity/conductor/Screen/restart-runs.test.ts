import { describe, expect, it, vi } from 'vitest';
import {
  restartCoveredRuns,
  restartRunsRequest,
} from '../../../../src/Entity/conductor/Screen/restart-runs.js';
import { ContextBag } from '../../../../src/Routing/context.js';
import {
  ConfirmDialogScreen,
  type ConfirmRequest,
  confirmRequestContext,
} from '../../../../src/Screen/confirm-dialog.js';
import type { ScreenContext } from '../../../../src/Screen/screen.js';
import { renderTree } from '../../../render-tree.js';
import { fakeClient, queryStringOf } from '../../../test-support.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Run = { id: string; state: string; ticket: string; log?: string };
type Ticket = { id: string; identifier: string; closed?: boolean; frozen?: boolean };

/**
 * The same shape as the PHP kernel fixture (RestartRunsTest): active runs,
 * a ticket whose newest run failed, one whose failure was followed by a
 * done run, and a closed ticket whose newest run failed.
 */
const RUNS: Run[] = [
  { id: 'r-running', state: 'running', ticket: 't-1' },
  { id: 'r-claimed', state: 'claimed', ticket: 't-2' },
  { id: 'r-failed', state: 'failed', ticket: 't-3', log: 'boom' },
  { id: 'r-old-failed', state: 'failed', ticket: 't-4' },
  { id: 'r-closed-failed', state: 'failed', ticket: 't-5' },
];
const NEWEST: Record<string, string> = {
  't-3': 'r-failed',
  't-4': 'r-later-done',
  't-5': 'r-closed-failed',
};
const TICKETS: Ticket[] = [
  { id: 't-1', identifier: 'BB-1', frozen: true },
  { id: 't-2', identifier: 'BB-2' },
  { id: 't-3', identifier: 'BB-3' },
  { id: 't-4', identifier: 'BB-4' },
  { id: 't-5', identifier: 'BB-5', closed: true },
];

/** A client answering the covered-set read and each ticket's newest run. */
const serverWith = (runs: Run[] = RUNS, failGet = false) => {
  const client = fakeClient();
  client.get = vi.fn(async (path: string, params?: unknown) => {
    if (failGet) throw new Error('read failed');
    const query = queryStringOf(params);
    expect(path).toBe('bb_run/bb_run');
    const newestOf = /filter\[ticket_id\.id\]=([^&]+)/.exec(query)?.[1];
    if (newestOf)
      return { data: [{ type: 'bb_run--bb_run', id: NEWEST[newestOf] }] };
    return {
      data: runs.map((run, i) => ({
        type: 'bb_run--bb_run',
        id: run.id,
        attributes: {
          state: run.state,
          drupal_internal__id: i + 1,
          error_log: run.log ?? null,
        },
        relationships: {
          ticket_id: { data: { type: 'bb_ticket--bb_ticket', id: run.ticket } },
        },
      })),
      included: TICKETS.map((t) => ({
        type: 'bb_ticket--bb_ticket',
        id: t.id,
        attributes: {
          identifier: t.identifier,
          closed: t.closed ?? false,
          frozen: t.frozen ?? false,
        },
      })),
    };
  }) as never;
  return client;
};

const dialogFor = async (request: ConfirmRequest, client: unknown) => {
  const screen = new ConfirmDialogScreen();
  const context: ScreenContext = {
    sessionGeneration: 1,
    requestDraw: vi.fn(),
    isActive: () => true,
    params: {},
    contexts: ContextBag.empty().set(confirmRequestContext, request),
    services: { client, writeClient: client, currentUser: 'cw' } as never,
    back: vi.fn(() => true),
  };
  screen.enter(context);
  await settle();
  return { screen, context };
};

const TARGET = {
  level: 'machine',
  label: 'workstation',
  conductorIds: ['c-1', 'c-2'],
  online: true,
} as const;

describe('restart runs covered set', () => {
  it('covers active runs and each open ticket newest failed run', async () => {
    const client = serverWith();
    const covered = await restartCoveredRuns(client, ['c-1', 'c-2']);
    expect(covered.map((run) => run.id)).toEqual([
      'r-running',
      'r-claimed',
      'r-failed',
    ]);
    const query = queryStringOf(vi.mocked(client.get).mock.calls[0]?.[1]);
    expect(query).toContain('filter[conductor_id.id][condition][value][0]=c-1');
    expect(query).toContain('filter[conductor_id.id][condition][value][1]=c-2');
  });
});

describe('restart runs dialog', () => {
  it('names the target, the runs and a frozen ticket', async () => {
    const { screen, context } = await dialogFor(
      restartRunsRequest(TARGET),
      serverWith(),
    );
    const shown = renderTree(screen.present(context).body).join(' ');
    expect(shown).toContain('Restart runs on machine workstation?');
    expect(shown).toContain('BB-1 · run #1 · running · frozen');
    expect(shown).toContain('BB-3 · run #3 · failed');
    expect(shown).not.toContain('BB-4');
    expect(shown).not.toContain('next start');
  });

  it('says cleanup and fresh runs follow the next start when offline', async () => {
    const { screen, context } = await dialogFor(
      restartRunsRequest({ ...TARGET, online: false }),
      serverWith(),
    );
    expect(renderTree(screen.present(context).body).join(' ')).toContain('next start');
  });

  it('confirming cancels each run with an appended note naming level and person', async () => {
    const client = serverWith();
    const { screen, context } = await dialogFor(
      restartRunsRequest(TARGET),
      client,
    );
    screen.handleInput('enter', context);
    await settle();
    const note = 'Restart runs (machine workstation) by cw';
    expect(client.writes).toEqual([
      { type: 'bb_run--bb_run', id: 'r-running', body: { attributes: { state: 'cancelled', error_log: note } } },
      { type: 'bb_run--bb_run', id: 'r-claimed', body: { attributes: { state: 'cancelled', error_log: note } } },
      { type: 'bb_run--bb_run', id: 'r-failed', body: { attributes: { state: 'cancelled', error_log: `boom\n${note}` } } },
    ]);
  });

  it('Esc writes nothing; a failed read writes nothing', async () => {
    const client = serverWith();
    const { screen, context } = await dialogFor(restartRunsRequest(TARGET), client);
    screen.handleInput('escape', context);
    await settle();
    expect(client.writes).toEqual([]);

    const failing = serverWith(RUNS, true);
    const failed = await dialogFor(restartRunsRequest(TARGET), failing);
    failed.screen.handleInput('enter', failed.context);
    await settle();
    expect(failing.writes).toEqual([]);
  });

  it('a list that changed since the dialog opened writes nothing', async () => {
    let runs = RUNS.slice(0, 1);
    const client = serverWith();
    const base = client.get;
    client.get = vi.fn((path: string, params?: unknown) =>
      (serverWith(runs).get as typeof base)(path, params),
    ) as never;
    const { screen, context } = await dialogFor(restartRunsRequest(TARGET), client);
    runs = RUNS.slice(0, 2);
    screen.handleInput('enter', context);
    await settle();
    expect(client.writes).toEqual([]);
    expect(renderTree(screen.present(context).body).join(' ')).toContain('changed');
  });
});
