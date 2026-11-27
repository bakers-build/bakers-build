// The site's bakers tools, proxied on the `bakers` MCP server with the
// conductor's own credentials. Only the allowlist is served, under the plain
// name. Reads go to any project; writes stay in the run ticket's project, except
// a create in another project and updates of the tickets the run created there.

import type { ConductorLogger } from '@bakers-build/core';
import type { SiteToolClient } from '../plugins/remote.js';
import type { ToolBinding } from '../plugins/tools.js';

/** The site tools a run may call. */
export const SITE_TOOLS: readonly string[] = [
  'bakers_ticket_read',
  'bakers_comment_read',
  'bakers_ticket_search',
  'bakers_ticket_create',
  'bakers_ticket_update',
  'bakers_ticket_classify',
  'bakers_ticket_transition',
  'bakers_run_cancel',
  'bakers_comment_create',
  'bakers_metric_write',
  'bakers_ticket_list',
  'bakers_run_list',
  'bakers_label_list',
  'bakers_project_read',
  'bakers_user_read',
  'bakers_user_search',
  'bakers_team_members',
  'bakers_conductor_list',
];

/** The site tools that change a ticket; a successful call signals `bakers ui`. */
export const SITE_WRITE_TOOLS: readonly string[] = [
  'bakers_ticket_create',
  'bakers_ticket_update',
  'bakers_ticket_classify',
  'bakers_ticket_transition',
  'bakers_run_cancel',
  'bakers_comment_create',
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

      // The site reads an empty project or workspace as no filter, so empty counts as missing.
      const blank = (v: unknown) => v === undefined || v === null || v === '';
      const scoped = { ...args };
      // Machine-wide cancellation can reach projects outside this run's scope.
      if (
        name === 'bakers_run_cancel' &&
        (blank(scoped.ticket) || !blank(scoped.machine_id))
      )
        throw new Error(
          'In a run, cancel by ticket only; machine_id is not allowed.',
        );
      if (FILLS_PROJECT.includes(name) && blank(scoped.project))
        scoped.project = project;
      if (
        name === 'bakers_label_list' &&
        ticket.workspaceId &&
        blank(scoped.workspace)
      )
        scoped.workspace = ticket.workspaceId;

      const refs: Array<['ticket' | 'project', string, unknown]> = [
        ['ticket', 'ticket', scoped.ticket],
        ['ticket', 'parent', scoped.parent],
        // blocked_by_remove only drops links on this run's own ticket.
        ...['referenced_tickets_add', 'blocked_by_add', 'blocked_by'].flatMap(
          (arg) =>
            [scoped[arg] ?? []]
              .flat()
              .map((r): ['ticket', string, unknown] => ['ticket', arg, r]),
        ),
        ['project', 'project', scoped.project],
      ];
      // A create may target another project; its parent and blockers come from there.
      // An update may reach a ticket this run created there.
      let home = project;
      if (name === 'bakers_ticket_create' && !blank(scoped.project))
        home = await ownerOf('project', String(scoped.project));
      if (name === 'bakers_ticket_update')
        home = owners.get(`created:${String(scoped.ticket)}`) ?? project;
      for (const [kind, arg, value] of refs) {
        if (value === undefined || value === null) continue;
        if (value === '') {
          // the site reads an empty ticket ref as none
          if (kind === 'ticket') continue;
          throw new Error(
            `${name}: an empty ${arg} would mean every project; this run may only touch project ${project}`,
          );
        }
        // the site decides who may read what
        if (READS.includes(name)) continue;
        const owner = await ownerOf(kind, String(value));
        if (owner !== home)
          throw new Error(
            `${name}: ${arg} ${String(value)} belongs to project ${owner}, this run may only touch project ${home}`,
          );
      }

      const result = await client.call(`${WIRE}${name}`, scoped);
      if (name === 'bakers_ticket_create' && home !== project) {
        // shortcut: kept in memory, so a conductor restart forgets it; persist it if runs need that.
        const out = resultJson(result);
        for (const ref of [out.id, out.identifier])
          if (ref) owners.set(`created:${String(ref)}`, home);
      }
      return { content: result.content };
    },
  };
}

/** Reads and lookups that may name any project or workspace. */
const READS = [
  'bakers_ticket_read',
  'bakers_comment_read',
  'bakers_ticket_search',
  'bakers_ticket_list',
  'bakers_project_read',
  'bakers_label_list',
  'bakers_conductor_list',
];

/** Tools whose missing `project` means the run's project. */
const FILLS_PROJECT = [
  'bakers_ticket_search',
  'bakers_ticket_list',
  'bakers_ticket_create',
];

/** Per run token: resolved ticket and project refs (the run's own ticket is known),
 * and `created:<ref>` → project of the tickets this run created in another project. */
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
