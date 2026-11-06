// The site's bakers tools, proxied on the `bakers` MCP server with the
// conductor's own credentials. Only the allowlist is served, under the plain
// name, and every call is held to the run ticket's project before it leaves.

import type { ConductorLogger } from '@bakers-build/core';
import type { SiteToolClient } from '../plugins/remote.js';
import type { ToolBinding } from '../plugins/tools.js';

/** The site tools a run may call. */
export const SITE_TOOLS: readonly string[] = [
  'bakers_ticket_read',
  'bakers_ticket_search',
  'bakers_ticket_create',
  'bakers_ticket_update',
  'bakers_ticket_classify',
  'bakers_ticket_transition',
  'bakers_comment_publish',
  'bakers_metric_write',
  'bakers_ticket_list',
  'bakers_ticket_runs_list',
  'bakers_label_list',
  'bakers_project_read',
  'bakers_user_read',
];

const WIRE = 'tool_api__';

export interface SiteTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface SiteToolProxy {
  /** The allowlisted site tools; none while the site is unreachable. */
  list(): Promise<SiteTool[]>;
  /** Forwards an allowed call; throws a refusal or the site's error text. */
  call(
    name: string,
    args: Record<string, unknown>,
    binding: ToolBinding,
  ): Promise<{ content: unknown[] }>;
}

export function siteToolProxy(
  client: SiteToolClient,
  logger?: ConductorLogger,
): SiteToolProxy {
  return {
    async list() {
      try {
        return (await client.list()).flatMap((t) => {
          const name = t.name.slice(WIRE.length);
          if (!t.name.startsWith(WIRE) || !SITE_TOOLS.includes(name)) return [];
          return [
            {
              name,
              ...(t.description === undefined
                ? {}
                : { description: t.description }),
              inputSchema: t.inputSchema,
            },
          ];
        });
      } catch (err) {
        // The client forgets a failed listing, so the next tools/list retries.
        logger?.warn(
          { err },
          'site tools unreachable; serving addon tools only',
        );
        return [];
      }
    },
    async call(name, args, binding) {
      const ticket = binding.ticket;
      const project = ticket?.projectId;
      if (!ticket || !project)
        throw new Error(
          `${name}: this run's ticket has no project, so it may call no site tool`,
        );
      const owners = ownersOf(binding, project);
      const ownerOf = async (kind: 'ticket' | 'project', ref: string) => {
        const key = `${kind}:${ref}`;
        let owner = owners.get(key);
        if (owner === undefined) {
          const read = await client.call(`${WIRE}bakers_${kind}_read`, {
            [kind]: ref,
          });
          const out = resultJson(read);
          owner = String(kind === 'ticket' ? out.project : out.uuid);
          owners.set(key, owner);
        }
        return owner;
      };

      const scoped = { ...args };
      if (FILLS_PROJECT.includes(name)) scoped.project ??= project;
      if (name === 'bakers_label_list' && ticket.workspaceId)
        scoped.workspace ??= ticket.workspaceId;

      const refs: Array<['ticket' | 'project', string, unknown]> = [
        ['ticket', 'ticket', scoped.ticket],
        ['ticket', 'parent', scoped.parent],
        ...[scoped.referenced_tickets_add ?? []]
          .flat()
          .map((r): ['ticket', string, unknown] => [
            'ticket',
            'referenced_tickets_add',
            r,
          ]),
        ['project', 'project', scoped.project],
      ];
      for (const [kind, arg, value] of refs) {
        if (value === undefined || value === null || value === '') continue;
        const owner = await ownerOf(kind, String(value));
        if (owner !== project)
          throw new Error(
            `${name}: ${arg} ${String(value)} belongs to project ${owner}, this run may only touch project ${project}`,
          );
      }
      if (
        scoped.workspace !== undefined &&
        scoped.workspace !== ticket.workspaceId
      )
        throw new Error(
          `${name}: workspace ${String(scoped.workspace)} is not the workspace ${ticket.workspaceId ?? '(none)'} of project ${project}`,
        );

      const { content } = await client.call(`${WIRE}${name}`, scoped);
      return { content };
    },
  };
}

/** Tools whose missing `project` means the run's project. */
const FILLS_PROJECT = [
  'bakers_ticket_search',
  'bakers_ticket_list',
  'bakers_ticket_create',
];

/** Ticket and project refs already resolved, per run token; the run's own ticket is known. */
const resolved = new WeakMap<ToolBinding, Map<string, string>>();

function ownersOf(binding: ToolBinding, project: string): Map<string, string> {
  let owners = resolved.get(binding);
  if (!owners) {
    owners = new Map([[`project:${project}`, project]]);
    const { ticket } = binding;
    if (ticket?.uuid) owners.set(`ticket:${ticket.uuid}`, project);
    if (ticket?.identifier) owners.set(`ticket:${ticket.identifier}`, project);
    resolved.set(binding, owners);
  }
  return owners;
}

/** A site tool's JSON result: structured content, else its first text part. */
function resultJson(result: {
  content: unknown[];
  structuredContent?: unknown;
}): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object')
    return result.structuredContent as Record<string, unknown>;
  const first = result.content[0] as { text?: string } | undefined;
  return JSON.parse(first?.text ?? '{}') as Record<string, unknown>;
}
