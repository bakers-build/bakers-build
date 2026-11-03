import { ASK_REDIRECT } from '@bakers-build/core';

/** The ticket fields the hook decides on (`bakers_ticket_read`). */
export interface HookTicket {
  labels?: unknown;
}

/** Claude Code's PreToolUse decision; `null` leaves the call to the normal flow. */
export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

const deny = (reason: string): PreToolUseOutput => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
});

/**
 * Decide an `AskUserQuestion` call. Outside a conductor run (no `BB_ID`) the
 * dialog stays usable. In a run it is denied when the ticket carries the label
 * "Autopilot", and also when the ticket cannot be read: an unattended run must
 * never wait on a terminal.
 */
export async function askUserQuestionDecision(
  env: { BB_ID?: string | undefined },
  readTicket: (ticket: string) => Promise<HookTicket>,
): Promise<PreToolUseOutput | null> {
  const id = env.BB_ID?.trim();
  if (!id) return null;
  let ticket: HookTicket;
  try {
    ticket = await readTicket(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = (message.split('\n')[0] ?? '').slice(0, 200);
    return deny(
      `The run's ticket ${id} could not be read (${reason}), so this may be an autopilot run. ${ASK_REDIRECT}`,
    );
  }
  const labels = Array.isArray(ticket.labels) ? ticket.labels : [];
  if (labels.includes('Autopilot')) return deny(ASK_REDIRECT);
  return null;
}
