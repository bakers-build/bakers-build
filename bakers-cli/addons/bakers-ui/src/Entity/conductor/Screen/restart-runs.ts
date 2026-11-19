import { siteTools } from '../../../lib/site-tools.js';
import type {
  ConfirmPrompt,
  ConfirmRequest,
} from '../../../Screen/confirm-dialog.js';
import type { ScreenContext } from '../../../Screen/screen.js';

/** One ticket with the runs a restart cancels, grouped from `bakers_run_list`. */
export interface RestartableTicket {
  readonly ticket: string;
  readonly title: string;
  readonly runs: readonly {
    readonly uuid: string;
    readonly number: number;
    readonly state: string;
  }[];
}

interface RestartableRun {
  uuid: string;
  number: number;
  state: string;
  ticket: string;
  ticket_title: string;
}

/** What Restart runs acts on: a machine, one conductor or one ticket. */
export interface RestartTarget {
  readonly level: 'machine' | 'conductor' | 'ticket';
  readonly label: string;
  /** The `bakers_run_list` input naming the target. */
  readonly args: Readonly<Record<string, string>>;
  /** Whether the conductor, or any conductor of the machine, is online. */
  readonly online?: boolean;
}

const readTickets = async (
  context: ScreenContext,
  target: RestartTarget,
): Promise<RestartableTicket[]> => {
  const result = await siteTools(context.services)('bakers_run_list', {
    ...target.args,
    restartable: true,
  });
  // The site lists the runs grouped by ticket; keep that order.
  const tickets = new Map<
    string,
    { ticket: string; title: string; runs: RestartableTicket['runs'][number][] }
  >();
  for (const run of (result.runs ?? []) as RestartableRun[]) {
    const { ticket, ticket_title, ...rest } = run;
    const entry = tickets.get(ticket) ?? {
      ticket,
      title: ticket_title,
      runs: [],
    };
    entry.runs.push(rest);
    tickets.set(ticket, entry);
  }
  return [...tickets.values()];
};

const runList = (ticket: RestartableTicket): string =>
  ticket.runs.map((run) => `run #${run.number} (${run.state})`).join(', ');

const sameTickets = (
  a: readonly RestartableTicket[],
  b: readonly RestartableTicket[],
) =>
  a
    .map((ticket) => ticket.ticket)
    .sort()
    .join() ===
  b
    .map((ticket) => ticket.ticket)
    .sort()
    .join();

/**
 * Restart runs, for the confirmation dialog. The site lists the covered runs
 * by ticket (`bakers_run_list` restartable); a machine or conductor offers its
 * tickets checked, a ticket confirms its own runs. OK reads the list again,
 * cancels nothing when it changed, and else cancels the runs of the checked
 * tickets in one `bakers_run_cancel`; the conductor gives each ticket one
 * fresh run.
 */
export const restartRunsRequest = (target: RestartTarget): ConfirmRequest => ({
  title: '↻ Restart runs',
  prepare: async (context): Promise<ConfirmPrompt> => {
    const tickets = await readTickets(context, target);
    const name =
      target.level === 'ticket'
        ? target.label
        : `${target.level} ${target.label}`;
    if (tickets.length === 0)
      return {
        message:
          target.level === 'ticket'
            ? 'There is no run to restart.'
            : `No runs to restart on ${name}.`,
      };
    const offline =
      target.online === false
        ? [
            'It is offline: tab and runtime cleanup and the fresh runs follow its next start.',
          ]
        : [];
    return {
      labels: { confirm: 'OK', close: 'Cancel' },
      ...(target.level === 'ticket'
        ? {
            message: `Restart ${name}?`,
            detail: `${tickets.map(runList).join(', ')} is cancelled; the ticket gets one fresh run.`,
          }
        : {
            message: `Restart runs on ${name}?`,
            detail: [
              "Each checked ticket's runs are cancelled; the ticket gets one fresh run.",
              ...offline,
            ].join('\n'),
            checklist: tickets.map((ticket) => ({
              id: ticket.ticket,
              label: `${ticket.ticket} · ${ticket.title} · ${runList(ticket)}`,
            })),
          }),
      confirm: async (confirmContext, checked) => {
        const fresh = await readTickets(confirmContext, target);
        if (!sameTickets(fresh, tickets))
          throw new Error(
            'The runs changed since the dialog opened. Open it again.',
          );
        const chosen =
          target.level === 'ticket'
            ? fresh
            : fresh.filter((ticket) => checked.includes(ticket.ticket));
        const runs = chosen.flatMap((ticket) => ticket.runs.map((r) => r.uuid));
        if (runs.length > 0)
          await siteTools(confirmContext.services)('bakers_run_cancel', {
            runs,
            reason: `Restart runs (${target.level} ${target.label})`,
          });
        return { type: 'runs-restarted', count: runs.length };
      },
    };
  },
});
