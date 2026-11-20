import { describe, expect, it, vi } from 'vitest';
import {
  type RestartableTicket,
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
import { fakeClient } from '../../../test-support.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const TICKETS: RestartableTicket[] = [
  {
    ticket: 'BB-1',
    title: 'Ship it',
    runs: [{ uuid: 'r-1', number: 1, state: 'running' }],
  },
  {
    ticket: 'BB-3',
    title: 'Fix it',
    runs: [{ uuid: 'r-3', number: 3, state: 'failed' }],
  },
];

/** The site's tools: the restartable run list flattens `tickets()`, a cancel echoes its runs. */
const siteWith = (
  tickets: () => RestartableTicket[] = () => TICKETS,
  refuse?: string,
) => {
  const callTool = vi.fn(
    async (name: string, args: Record<string, unknown>) => {
      if (name === 'bakers_run_list')
        return {
          runs: tickets().flatMap((t) =>
            t.runs.map((run) => ({
              ...run,
              ticket: t.ticket,
              ticket_title: t.title,
            })),
          ),
          next_offset: null,
        };
      if (refuse) throw new Error(refuse);
      return { runs: args.runs };
    },
  );
  const client = Object.assign(fakeClient(), { callTool });
  const cancels = () =>
    callTool.mock.calls.filter(([name]) => name === 'bakers_run_cancel');
  return { client, callTool, cancels };
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
  const shown = () => renderTree(screen.present(context).body).join('\n');
  return { screen, context, shown };
};

const MACHINE = {
  level: 'machine',
  label: 'workstation',
  args: { machine_id: 'host-1' },
  online: true,
} as const;

describe('restart runs dialog', () => {
  it('reads the restartable tickets and lists them checked, with OK and Cancel', async () => {
    const site = siteWith();
    const { shown } = await dialogFor(restartRunsRequest(MACHINE), site.client);
    expect(site.callTool).toHaveBeenCalledWith('bakers_run_list', {
      machine_id: 'host-1',
      restartable: true,
    });
    expect(shown()).toContain('Restart runs on machine workstation?');
    expect(shown()).toContain('[x] BB-1 · Ship it · run #1 (running)');
    expect(shown()).toContain('[x] BB-3 · Fix it · run #3 (failed)');
    expect(shown()).toContain('[ OK ]');
    expect(shown()).toContain('[ Cancel ]');
    expect(shown()).not.toContain('next start');
  });

  it('says cleanup and fresh runs follow the next start when offline', async () => {
    const { shown } = await dialogFor(
      restartRunsRequest({ ...MACHINE, online: false }),
      siteWith().client,
    );
    expect(shown()).toContain('next start');
  });

  it('OK cancels the runs of the checked tickets through bakers_run_cancel', async () => {
    const site = siteWith();
    const { screen, context } = await dialogFor(
      restartRunsRequest(MACHINE),
      site.client,
    );
    screen.handleInput('down', context);
    screen.handleInput(' ', context);
    screen.handleInput('enter', context);
    await settle();
    expect(site.cancels()).toEqual([
      [
        'bakers_run_cancel',
        { runs: ['r-1'], reason: 'Restart runs (machine workstation)' },
      ],
    ]);
    expect(context.back).toHaveBeenCalledWith({
      type: 'runs-restarted',
      count: 1,
    });
  });

  it('OK with none checked and Esc cancel nothing', async () => {
    const site = siteWith();
    const none = await dialogFor(restartRunsRequest(MACHINE), site.client);
    none.screen.handleInput(' ', none.context);
    none.screen.handleInput('down', none.context);
    none.screen.handleInput(' ', none.context);
    none.screen.handleInput('enter', none.context);
    await settle();
    const esc = await dialogFor(restartRunsRequest(MACHINE), site.client);
    esc.screen.handleInput('escape', esc.context);
    await settle();
    expect(site.cancels()).toEqual([]);
  });

  it('a ticket list that changed since the dialog opened cancels nothing', async () => {
    let tickets = TICKETS.slice(0, 1);
    const site = siteWith(() => tickets);
    const { screen, context, shown } = await dialogFor(
      restartRunsRequest(MACHINE),
      site.client,
    );
    tickets = TICKETS;
    screen.handleInput('enter', context);
    await settle();
    expect(site.cancels()).toEqual([]);
    expect(shown()).toContain('changed');
  });

  it("shows the server's refusal", async () => {
    const site = siteWith(() => TICKETS, 'You may not cancel run r-1.');
    const { screen, context, shown } = await dialogFor(
      restartRunsRequest(MACHINE),
      site.client,
    );
    screen.handleInput('enter', context);
    await settle();
    expect(shown()).toContain('You may not cancel run r-1.');
  });

  it('a conductor asks by its uuid', async () => {
    const site = siteWith();
    await dialogFor(
      restartRunsRequest({
        level: 'conductor',
        label: 'north',
        args: { conductor: 'c-1' },
        online: true,
      }),
      site.client,
    );
    expect(site.callTool).toHaveBeenCalledWith('bakers_run_list', {
      conductor: 'c-1',
      restartable: true,
    });
  });

  it('a target with nothing to restart offers nothing to confirm', async () => {
    const site = siteWith(() => []);
    const { screen, context, shown } = await dialogFor(
      restartRunsRequest(MACHINE),
      site.client,
    );
    expect(shown()).toContain('No runs to restart on machine workstation.');
    screen.handleInput('enter', context);
    await settle();
    expect(site.cancels()).toEqual([]);
  });
});
