// BB-351: the ambient workspace, filled transparently on the CLI/API side.
// BB-472: the same ambient workspace now also narrows COLLECTION reads.
//
// The server contract is unchanged: a JSON:API create payload always NAMES the
// workspace, and `BbWorkspaceScope` is the one gate on the write. What this
// addon removes is the requirement that a *caller* remember it — so no caller
// has to, and no caller can forget. It hangs off dropsh 0.6.0's `alterRequest`
// hook, which runs after auth and before the request goes out (and whose result
// the 401-renewal retry re-sends, so the injection survives a token refresh).
//
// Client-side read scoping matters even though the server already isolates by
// OG membership: membership is wider than the configured workspace. A user can
// belong to several workspaces at once, so "may I see this row?" (the server's
// question) is not the same as "which one did I configure for this connection?"
// (this addon's question). Without this filter a search returns every workspace
// the caller may see; with it, exactly the one named in `workspace_id`.
//
// WHERE THE UUID COMES FROM. This addon is loaded unconditionally, as a child of
// `@bakers-build/addon-essentials`, so it carries no `with` of its own in any config.
// Its uuid is the connection config's TOP-LEVEL, REQUIRED `workspace_id`, which
// `loadBbConfig` reads and hands to every preset as a global option. A `with`
// is still honoured if some config sets one directly, and wins — but nothing in
// the shipped configs does.
import type { DropSHPlugin, HttpRequest, RequestContext } from 'dropsh/plugin';

/**
 * The entity types whose workspace is a DIRECT `workspace_id` field, and which
 * this addon may therefore fill from context.
 *
 * `bb_project` and `bb_ticket` are deliberately ABSENT. Their workspace
 * anchor is `group_id` / `project_id` — a genuine choice the caller must make
 * (which group? which project?), not an ambient fact. The server narrows the
 * offer for those two (`GroupInActiveWorkspaceSelection` /
 * `ProjectInActiveWorkspaceSelection`) and `BbWorkspaceScope` gates the write;
 * guessing one here would be inventing data, not supplying context.
 *
 * `bb_term` joined in BB-339. It meets the criterion exactly — a direct
 * `workspace_id`, and which workspace a label belongs to is ambient rather than
 * chosen — and it is not merely a convenience: qualification (`bb-workflow`) creates a
 * missing `work:*` term through dropsh, so without this entry that step answers
 * 422 on `workspace_id` on every instance where the term is not seeded yet.
 */
export const DEFAULT_WORKSPACE_ENTITY_TYPES: readonly string[] = [
  'bb_group',
  'bb_team',
  'bb_term',
];

/**
 * Entity type → the JSON:API field path from it to the `bb_workspace` uuid.
 *
 * This is a SECOND list beside DEFAULT_WORKSPACE_ENTITY_TYPES and not an
 * extension of it, because the two answer different questions. That one asks
 * "is the workspace an ambient fact on a create?" and excludes bb_project and
 * bb_ticket precisely because choosing their group/project is the caller's
 * decision. This one asks "how is this type reachable from a workspace?", and
 * for those two the answer exists — it is just longer.
 *
 * `bb_workspace` itself is deliberately ABSENT (BB-472 live verification):
 * a `bb_workspace` collection search is exactly how `discoverBbWorkspaces()`
 * lists what an identity can switch to, and narrowing it to
 * `id = <the already-configured workspace>` would make every reachable
 * workspace but the current one invisible — defeating the switch this ticket
 * builds. Server-side membership (F2) already bounds that collection to what
 * the identity may see; this client-side layer answers "which one is
 * configured for creates/other reads", a question that does not apply to the
 * workspace list itself.
 */
export const WORKSPACE_READ_SCOPE_PATHS: Readonly<
  Record<string, string | readonly string[]>
> = {
  bb_group: 'workspace_id.id',
  bb_team: 'workspace_id.id',
  // bb_machine is account-owned: it has no workspace_id, and
  // machineCapacity() must not send one. Isolation is owner_user_id on the
  // server, not this client filter.
  bb_term: 'workspace_id.id',
  bb_project: 'group_id.workspace_id.id',
  bb_ticket: 'project_id.group_id.workspace_id.id',
  bb_environment: 'project_id.group_id.workspace_id.id',
  bb_conductor: 'project_id.group_id.workspace_id.id',
  // Exactly one of project and workspace is set on a template: either path
  // admits it (an OR group).
  bb_ticket_template: [
    'project_id.group_id.workspace_id.id',
    'workspace_id.id',
  ],
  bb_run: 'ticket_id.project_id.group_id.workspace_id.id',
  bb_comment: 'ticket_id.project_id.group_id.workspace_id.id',
};

/**
 * BB-495 D5: every UI collection read that is NOT workspace-scoped by
 * {@link WORKSPACE_READ_SCOPE_PATHS} and is, deliberately, not a gap to close
 * here — closing one would be its own behaviour change and its own scope. The
 * completeness gate (`addons/bakers-ui/tests/workspace-scope-coverage.test.ts`)
 * derives every collection the UI reads from its source tree and fails on any
 * that is neither covered above nor named here, so a new unscoped read is
 * caught rather than silently added to an ever-growing exception list.
 */
export const UI_COLLECTION_EXCEPTIONS: readonly string[] = [
  // `user` is not a bakers.build entity type — `WorkspaceReadScopeSubscriber`
  // registers nothing for it (it hangs off `entity.query_access.<type>` for
  // bakers.build types only), so `WORKSPACE_READ_SCOPE_PATHS` cannot list it either.
  'user',
  // A bespoke resource, not an entity query — `Entity/user/Data/users.ts:41`
  // already called it "unscoped statistics" before this gate existed.
  'bakers/statistics',
  // OG core's own membership resource, not a bakers.build entity type either — the
  // same class of gap as `user`, for the same subscriber-registration reason.
  'og_membership',
  // Deliberately never scoped, not merely unregistered: `bb_workspace`
  // itself IS the reachable-workspace list — narrowing it to the already-
  // configured workspace would make every workspace but the current one
  // invisible, defeating the picker/switch this collection exists for.
  // Server-side membership already bounds it to what the identity may see.
  'bb_workspace',
  // A bespoke resource keyed by ONE ticket's UUID, gated on view access to that
  // ticket — the ticket already sits in the workspace it belongs to, so there
  // is no collection to narrow.
  'bakers/addons/ticket',
];

/** The filter group name. Unique by construction, so a caller filter cannot collide. */
const READ_SCOPE_FILTER = 'bb_ambient_workspace';

/** The JSON:API resource type of the workspace a `workspace_id` names. */
const WORKSPACE_RESOURCE_TYPE = 'bb_workspace--bb_workspace';

/** The relationship this addon fills. */
const WORKSPACE_FIELD = 'workspace_id';

/** Options for the workspace addon — normally the connection config's globals. */
export interface WorkspaceOptions {
  /**
   * The UUID of the `bb_workspace` every create is bound to. REQUIRED at the
   * top level of the connection config; `loadBbConfig` rejects a config
   * without it, so by the time this addon runs the value is present.
   */
  workspace_id?: string;
  /**
   * Override the entity types whose `workspace_id` is filled from context.
   * Defaults to `DEFAULT_WORKSPACE_ENTITY_TYPES`; configurable so a site that
   * adds a further directly-bound type does not need a new addon release.
   */
  entity_types?: string[];
}

/** No workspace configured, but a create needed one. Named so `PluginError` reads. */
export class WorkspaceConfigError extends Error {
  override readonly name = 'WorkspaceConfigError';
}

/** The create body was not parseable JSON — fail loudly, never half-parse. */
export class WorkspacePayloadError extends Error {
  override readonly name = 'WorkspacePayloadError';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The bakers.build workspace plugin. Constructed by the `./preset` accumulator from the
 * connection config's global options (via `@bakers-build/addon-essentials`, which
 * lists this addon as a preset child), or directly by dropsh from a legacy
 * `plugins: []` descriptor (this module default-exports the factory, so no
 * `export:` is needed either way).
 */
export function workspacePlugin(opts: WorkspaceOptions = {}): DropSHPlugin {
  const workspaceId =
    typeof opts.workspace_id === 'string' ? opts.workspace_id.trim() : '';
  const entityTypes = new Set(
    opts.entity_types ?? [...DEFAULT_WORKSPACE_ENTITY_TYPES],
  );

  return {
    id: 'bakers-workspace',
    requiredModules: [],
    async alterRequest(
      req: HttpRequest,
      ctx: RequestContext,
    ): Promise<HttpRequest> {
      // Reads: narrow a COLLECTION to the configured workspace. `read` (an
      // individual resource by uuid) is deliberately absent — JSON:API ignores
      // filters on individual endpoints, so appending one there would be code that
      // lies about what it does. Isolation on that path stays the server's.
      if (ctx.operation === 'search') {
        const path = ctx.entityType
          ? WORKSPACE_READ_SCOPE_PATHS[ctx.entityType]
          : undefined;
        if (workspaceId === '' || path === undefined) return req;
        const url = new URL(req.url);
        const condition = (name: string, conditionPath: string) => {
          url.searchParams.set(
            `filter[${name}][condition][path]`,
            conditionPath,
          );
          url.searchParams.set(`filter[${name}][condition][operator]`, '=');
          url.searchParams.set(
            `filter[${name}][condition][value]`,
            workspaceId,
          );
        };
        if (typeof path === 'string') {
          condition(READ_SCOPE_FILTER, path);
        } else {
          url.searchParams.set(
            `filter[${READ_SCOPE_FILTER}][group][conjunction]`,
            'OR',
          );
          path.forEach((alternative, i) => {
            condition(`${READ_SCOPE_FILTER}_${i}`, alternative);
            url.searchParams.set(
              `filter[${READ_SCOPE_FILTER}_${i}][condition][memberOf]`,
              READ_SCOPE_FILTER,
            );
          });
        }
        return { ...req, url: url.toString() };
      }

      // (1) Creates only. An `update` that re-binds an existing row to another
      // workspace is a real decision governed by the server's own rule — never
      // something to slip in ambiently — so PATCH is passed through untouched.
      if (ctx.operation !== 'create') return req;

      // (2) Only the types whose workspace is a direct `workspace_id` field.
      if (ctx.entityType === undefined || !entityTypes.has(ctx.entityType)) {
        return req;
      }

      // (3) `upload` bodies are binary; nothing to parse.
      if (typeof req.body !== 'string') return req;

      // (6) A create that needs a workspace with none configured must not go out
      // unbound — the server would answer 422 and the cause would be invisible.
      // dropsh wraps this in a PluginError carrying `bakers-workspace`. Normally
      // unreachable: `workspace_id` is required at config load.
      if (workspaceId === '') {
        throw new WorkspaceConfigError(
          `@bakers-build/addon-workspace: creating a "${ctx.entityType}" needs an ambient workspace, but none is configured. ` +
            `Set the top-level \`${WORKSPACE_FIELD}: '<bb_workspace uuid>'\` in your connection config (~/.bakers/connections/default.js).`,
        );
      }

      // (7) Malformed JSON must fail by name, never be swallowed into a request
      // that is half-rewritten.
      let doc: unknown;
      try {
        doc = JSON.parse(req.body);
      } catch (cause) {
        throw new WorkspacePayloadError(
          `@bakers-build/addon-workspace: the "${ctx.entityType}" create body is not valid JSON, so the ambient workspace could not be applied: ${String(cause)}`,
        );
      }
      if (!isRecord(doc) || !isRecord(doc.data)) return req;

      const relationships = isRecord(doc.data.relationships)
        ? doc.data.relationships
        : undefined;

      // (4) An explicit value ALWAYS wins over the ambient one.
      if (relationships && WORKSPACE_FIELD in relationships) return req;

      // (5) Inject. Headers are untouched by construction — only `body` is
      // replaced, so `Authorization` (applied before this hook) survives verbatim.
      const next = {
        ...doc,
        data: {
          ...doc.data,
          relationships: {
            ...(relationships ?? {}),
            [WORKSPACE_FIELD]: {
              data: { type: WORKSPACE_RESOURCE_TYPE, id: workspaceId },
            },
          },
        },
      };
      return { ...req, body: JSON.stringify(next) };
    },
  };
}

export default workspacePlugin;
