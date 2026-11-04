// Ticket-create launch request (AC-3). Pressing `n` starts an embedded agent
// that follows WORKFLOW.md and `bb-create-ticket`. This module is pure: it builds
// the launch intent (prompt + env) the TUI hands to the injected agent host
// (`services.agents.launch`); the host (herdr) owns transport + layout. No
// node-pty / @xterm, no session object.

import type { CreateFormPayload } from '../Entity/ticket/Form/create.js';
import type { TuiAgentService } from '../types.js';

const CREATE_PROMPT =
  "Read the repository's WORKFLOW.md and follow it, then use the bb-create-ticket " +
  'skill to create a new bakers.build ticket from the intake in ' +
  '$BB_NEW_TICKET_INPUT. Do not start work on the new ticket.';

/** The launch intent passed to {@link TuiAgentService.launch}. */
export type CreateLaunch = Parameters<TuiAgentService['launch']>[0];

/**
 * Build the `ticket:create` launch intent for a project. The prompt is a pure
 * pointer to WORKFLOW.md and `bb-create-ticket` (the pre-filled form is passed
 * via `$BB_NEW_TICKET_INPUT`); `BB_ID` is never inherited (a create must not be
 * bound to a claimed ticket).
 */
export function buildCreateLaunch(opts: {
  project: string;
  cwd: string;
  specPath?: string | undefined;
  workflow?: string | undefined;
  createPrompt?: string | undefined;
  label?: string | undefined;
}): CreateLaunch {
  const env: Record<string, string | undefined> = {
    ...process.env,
    TERM: 'xterm-256color',
    BB_PROJECT: opts.project,
  };
  delete env.BB_ID;
  if (opts.specPath) env.BB_NEW_TICKET_INPUT = opts.specPath;
  if (opts.workflow) env.BB_WORKFLOW = opts.workflow;
  return {
    group: opts.project,
    cwd: opts.cwd,
    prompt: opts.createPrompt?.trim() || CREATE_PROMPT,
    env,
    isNew: true,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  };
}

/**
 * A short human label for the agent list: the ticket's title, else the
 * description's first line (both capped to 40 incl. the ellipsis), else
 * "New <workflow>". BB-236 AC-8: it builds the `label` `buildCreateLaunch`
 * takes, so it belongs to the module that builds the launch intent.
 */
export function shortName(payload: CreateFormPayload): string {
  // BB-309 D9: the title is what the operator NAMED the ticket, so it is the
  // better tab label; the description's first line stays the fallback for a
  // payload that has no title yet. This touches the launch intent's `label`
  // ONLY — never `prompt`, never `env`, which is what AC-6 pins.
  const cap = (line: string): string =>
    line.length > 40 ? `${line.slice(0, 39)}…` : line;
  const title = payload.title.trim();
  if (title) return cap(title);
  const firstLine = payload.description
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) return cap(firstLine);
  return `New ${payload.workflow?.label ?? 'ticket'}`;
}
