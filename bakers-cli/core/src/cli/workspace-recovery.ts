import { shellQuote } from '../core/shell.js';
import type { BbCommandHost } from './commands.js';
import { createBbConnectionClient } from './config-online.js';
import {
  type BbConnectionConfig,
  type BbConnectionLoadOptions,
  loadBbConnectionBootstrap,
} from './load-bakers-config.js';

export interface WorkspaceChoice {
  id: string;
  name: string;
}
export interface WorkspaceRecoveryOptions extends BbConnectionLoadOptions {
  /** Product-workspace name supplied by the owner of project configuration. */
  workspaceSelector?: string;
  interactive?: boolean;
  ci?: boolean;
  yes?: boolean;
  format?: string;
  stateDir?: string;
  prompt?: (choices: WorkspaceChoice[]) => Promise<string | undefined>;
}
export function workspaceSearchCommand(path: string): string {
  return `bakers dropsh --config ${shellQuote(path)} --format md search bb_workspace`;
}

/** A UUID looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a `--workspace <name|uuid>` CLI selector against the workspaces the
 * authenticated identity can actually see. A uuid is taken as-is (no lookup
 * needed to know which row it names); a name is matched exactly and must be
 * unique among the reachable choices — the same ambiguity a `bb_project`
 * name can carry applies here, so this refuses to guess (BB-472).
 */
export function resolveWorkspaceSelector(
  choices: WorkspaceChoice[],
  selector: string,
): string {
  if (choices.some((c) => c.id === selector)) return selector;
  if (UUID_RE.test(selector)) return selector;
  const matches = choices.filter((c) => c.name === selector);
  if (matches.length > 1)
    throw new Error(
      `Workspace name "${selector}" is ambiguous: ${matches.length} reachable workspaces share it. Use its uuid instead.`,
    );
  const hit = matches[0];
  if (hit) return hit.id;
  const reachable = choices.map((c) => c.name).join(', ');
  throw new Error(
    `Unknown workspace "${selector}". Reachable workspaces: ${reachable || '(none)'}.`,
  );
}

/** Follow every result page through the selected authenticated connection. */
export async function discoverBbWorkspaces(
  connection: BbConnectionConfig,
  options: { stateDir?: string } = {},
): Promise<WorkspaceChoice[]> {
  const client = await createBbConnectionClient(connection, options);
  const root = new URL(
    `${connection.site.base_url.replace(/\/$/, '')}/${connection.site.jsonapi_prefix.replace(/^\/+|\/+$/g, '')}/`,
  );
  let path = '/bb_workspace/bb_workspace';
  const seen = new Set<string>();
  const found = new Map<string, WorkspaceChoice>();
  for (;;) {
    if (seen.has(path)) throw new Error('Repeated workspace result page');
    seen.add(path);
    const doc = (await client.get(path)) as {
      data?: Array<{
        id?: string;
        type?: string;
        attributes?: { name?: string; label?: string };
      }>;
      links?: { next?: string | { href?: string } | null };
    };
    if (!Array.isArray(doc.data))
      throw new Error('Invalid workspace collection');
    for (const row of doc.data) {
      if (row.type !== 'bb_workspace--bb_workspace' || !row.id)
        throw new Error('Invalid workspace resource');
      found.set(row.id, {
        id: row.id,
        name: row.attributes?.name ?? row.attributes?.label ?? row.id,
      });
    }
    const next =
      typeof doc.links?.next === 'string'
        ? doc.links.next
        : doc.links?.next?.href;
    if (!next) break;
    const url = new URL(next, new URL(path.replace(/^\//, ''), root));
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname))
      throw new Error(
        'Workspace pagination left the configured JSON:API endpoint',
      );
    path = `/${url.pathname.slice(root.pathname.length)}${url.search}`;
  }
  return [...found.values()];
}

/**
 * Load the connection `bakers dropsh` and `bakers ui` both dispatch against.
 *
 * BB-495 F8: this used to also OWN workspace recovery — refusing a config
 * with no `workspace_id`, then prompting and writing a selection back into
 * the config file. That is exactly the interactive-recovery behaviour spec
 * D3 introduced `bakers info` to replace ("reads rather than prompts, and
 * writes nothing back into a config file"), yet it was still the one this
 * function ran by default, so `bakers dropsh` kept refusing a keyless config
 * (AC7) and, interactively, kept writing to disk anyway. `workspace_id` is
 * optional now. Project configuration is interpreted by its owning package;
 * this function accepts only the resulting selector value and resolves it.
 */
export async function loadReadyBbConnection(
  host: BbCommandHost,
  options: WorkspaceRecoveryOptions = {},
): Promise<BbConnectionConfig> {
  const connection = await loadBbConnectionBootstrap(host, options);
  if (!options.workspaceSelector) return connection;
  const choices = await discoverBbWorkspaces(connection, {
    ...(options.stateDir ? { stateDir: options.stateDir } : {}),
  });
  const workspaceId = resolveWorkspaceSelector(
    choices,
    options.workspaceSelector,
  );
  const resolved = await loadBbConnectionBootstrap(host, {
    ...options,
    workspaceIdOverride: workspaceId,
  });
  if (!host.workspacePlugin) return resolved;
  return {
    ...resolved,
    plugins: [...resolved.plugins, await host.workspacePlugin(workspaceId)],
  };
}
