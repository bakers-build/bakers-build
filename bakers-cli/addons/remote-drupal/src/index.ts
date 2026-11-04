import { createBbConnectionContext, toUnixSeconds } from '@bakers-build/core';

// BB-224 (Finding 6, decision 8): the Drupal control-plane remote — formerly
// `@bakers-build/core`'s `plugins/remote/drupal.ts`, now its own conductor-surface
// addon. Core ships no plugin implementations; every mountable lives under
// `addons/*`. The surface contract comes from `@bakers-build/conductor/contract`
// (runtime-light: types + the tiny selectors, no engine).

import type {
  ActiveRun,
  AddonDefinitionV2,
  AddonRegistration,
  BbRemote,
  ClaimedRun,
  ClaimOptions,
  ClaimWithheld,
  ConductorFileConfig,
  ConductorRegistration,
  ConductorStatus,
  FinalizableRun,
  FrozenTicket,
  InboxSnapshot,
  RemotePlugin,
  RunMetrics,
  RunWriteAttributes,
  Ticket,
  TicketMetric,
  UncleanTicket,
} from '@bakers-build/conductor/contract';
import {
  AmbiguousProjectNameError,
  ConductorTakeoverRequired,
  resolveBbProjectContext,
} from '@bakers-build/conductor/contract';
import type { MessageResult } from '@bakers-build/message';

export {
  AmbiguousProjectNameError,
  ConductorTakeoverRequired,
} from '@bakers-build/conductor/contract';
export { createRunLogHttp, RunLogSizeError } from './run-log-http.js';

import type { BbProjectSelection } from '@bakers-build/conductor/project-context';
import {
  type AuthAdapter,
  type HttpClient,
  HttpError,
  type JsonApiClient,
} from 'dropsh/plugin';
import { createRunLogHttp, RunLogSizeError } from './run-log-http.js';

/**
 * Fetches a run's current `log` transcript through the download route
 * (BB-556 Finding 1), never through the JSON:API `log` attribute: since
 * `BbRun::preSave()` always clears that attribute after moving its payload
 * to a file, the attribute is empty on every reload and trusting it silently
 * drops the real transcript.
 *
 * Addresses `bb_core.run_log_download_api`, not the workspace-prefixed
 * `bb_core.run_log_download` (review finding C2): a route whose path starts
 * with `/_workspace/{bb_workspace}` is rewritten by
 * `BbWorkspaceRouteSubscriber` to require a real workspace SLUG in that
 * segment, and the internal `_workspace` literal a client might try as a
 * placeholder is deliberately made unaddressable by
 * `BbWorkspacePathProcessor` — so a placeholder segment 404s before the
 * route's own access check ever runs. The `_api` route sits outside that
 * prefix and needs no slug at all; its gate is `bb_run.view`, identical to
 * the workspace-prefixed one.
 *
 * CR1: the path is `/_bakers-api/run/{uuid}/log/{kind}`, not `/bakers/run/...` —
 * `bakers` is the default workspace's slug (`BbWorkspace::DEFAULT_SLUG`), so a
 * leading `bakers` segment collided with `BbWorkspacePathProcessor`, which
 * rewrites ANY first segment matching a live workspace slug. `_bakers-api`
 * starts with an underscore, which the slug pattern forbids, so it can never
 * collide with a workspace.
 */
export type RunLogFetcher = (runUuid: string) => Promise<string>;

export function createRunLogFetcher(
  http: HttpClient,
  auth: AuthAdapter,
  baseUrl: string,
): RunLogFetcher {
  return async (runUuid: string): Promise<string> => {
    const base = baseUrl.replace(/\/+$/, '');
    const request = await auth.apply({
      method: 'GET',
      url: `${base}/_bakers-api/run/${runUuid}/log/log`,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    // CR2: a plain 404 means the route didn't resolve at all (bad path, wrong
    // workspace routing, run not found) — that must fail loudly, never be
    // read as "no transcript". Only a 204 ("no log file referenced") is the
    // distinct, intentional "no transcript" signal from RunLogController, so
    // only that maps to ''. Treating 404 as '' is exactly what let a routing
    // bug (CR1) make appendRunNote() silently destroy real transcripts.
    const res = await http.send(request);
    if (res.status === 204) {
      return '';
    }
    return res.body;
  };
}

const ACTIVE = ['claimed', 'running'];

/** A JSON:API relationship reference (one member of a to-many `data`). */
interface JsonApiRef {
  type: string;
  id: string;
}

/** A JSON:API included resource (sideloaded via `?include=`). */
interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: JsonApiRef | JsonApiRef[] | null }>;
}

/** Minimal shape of a JSON:API `bb_ticket` document (+ sideloaded includes). */
interface JsonApiTicketDoc {
  data?: {
    id?: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<
      string,
      { data?: JsonApiRef[] | JsonApiRef | null } | undefined
    >;
  };
  included?: JsonApiResource[];
}

/**
 * The process-identity attributes a registration carries, if any (BB-232).
 *
 * Spread rather than assigned so an absent value sends no key at all: the
 * server treats a missing key as "leave the stored value alone", which is what
 * lets `poll` and `reap` heartbeat past a running conductor without wiping the
 * pid it needs to be stoppable.
 */
function processIdentity(
  reg: ConductorRegistration,
): Record<string, number | string> {
  return {
    ...(reg.last_pid === undefined ? {} : { last_pid: reg.last_pid }),
    ...(reg.conductor_name === undefined
      ? {}
      : { conductor_name: reg.conductor_name }),
  };
}

/**
 * The default `fetchRunLog`, used only where a construction site passes none.
 *
 * Review finding C3: the previous default (`async () => ''`) made "cannot
 * fetch the transcript" indistinguishable from "there is no transcript",
 * which is exactly the condition that let `appendRunNote()` silently replace
 * a transcript with the reaper note. A construction site that genuinely never
 * calls `appendRunNote()` never hits this; one that does gets a clear error
 * instead of quiet data loss.
 */
async function throwingRunLogFetcher(): Promise<string> {
  throw new Error(
    'DrupalBbRemote was constructed without a fetchRunLog implementation; appendRunNote() cannot read the existing transcript.',
  );
}

export class DrupalBbRemote implements BbRemote {
  constructor(
    private readonly api: JsonApiClient,
    private readonly selection?: BbProjectSelection,
    private readonly resolvedProjectId?: string,
    private readonly fetchRunLog: RunLogFetcher = throwingRunLogFetcher,
  ) {}

  async fetchActiveRuns(id: string): Promise<ActiveRun[]> {
    // The conductor identity `id` is the registration key (conductor_id).
    // bb_run links to its owning conductor via the `conductor_id` entity-ref;
    // filter on the related conductor's registration string field.
    const rows = await this.api
      .collection('bb_run')
      .where('conductor_id.conductor_id', '=', id)
      .whereIn('state', ACTIVE)
      .fields(['state', 'state_at_start', 'worktree_path'])
      .page(100)
      .list();
    return Promise.all(
      rows.map(async (r) => ({
        runUuid: r.id,
        ticketUuid: r.rel('ticket_id') ?? '',
        ticketIdentifier: await this.getRunTicketIdentifier(r.id),
        branchName: await this.getRunTicketBranchName(r.id),
        state: r.attr<string>('state') ?? '',
        stateAtStart: r.attr<string>('state_at_start') ?? '',
        worktreePath: r.attr<string>('worktree_path') ?? '',
      })),
    );
  }

  async activeRunCount(id: string): Promise<number> {
    // Filter on the related conductor's registration string field.
    return this.api
      .collection('bb_run')
      .where('conductor_id.conductor_id', '=', id)
      .whereIn('state', ACTIVE)
      .fields(['drupal_internal__id'])
      .page(100)
      .count();
  }

  async machineCapacity(
    hostKey: string,
  ): Promise<{ maxParallel: number; currentLoad: number } | null> {
    // Shared host budget (BB-353 D5): read bb_machine after heartbeat so
    // current_load is peers + this process. Filter on host_key (MachineContext
    // stem), not the composed conductor_id.
    const row = await this.api
      .collection('bb_machine')
      .where('host_key', '=', hostKey)
      .fields(['max_parallel', 'current_load'])
      .first();
    const maxParallel = row?.attr<number>('max_parallel');
    if (!row || maxParallel == null) return null;
    return {
      maxParallel,
      currentLoad: row.attr<number>('current_load') ?? 0,
    };
  }

  async claimNext(c: ClaimOptions): Promise<ClaimedRun | ClaimWithheld | null> {
    const res = (await this.api.post('bakers/claim-next', {
      data: {
        attributes: {
          lease_seconds: c.leaseSeconds,
          // Server (`ConductorResolverTrait`) narrows to the caller's conductor
          // by conductor_id (legacy machine_id still accepted).
          conductor_id: c.conductorId,
          machine_id: c.conductorId,
        },
      },
    })) as {
      meta?: {
        claim?: {
          reason?: string;
          occupancy?: number;
          capacity?: number;
          retry_at?: null;
        };
      };
      data?: {
        id: string;
        attributes?: Record<string, unknown> & { drupal_internal__id?: number };
        relationships?: { ticket_id?: { data?: { id?: string } } };
      };
    };
    if (!res?.data) {
      const claim = res?.meta?.claim;
      if (claim?.reason === 'machine_capacity') {
        if (
          typeof claim.occupancy !== 'number' ||
          typeof claim.capacity !== 'number' ||
          !Number.isInteger(claim.occupancy) ||
          !Number.isInteger(claim.capacity) ||
          claim.capacity < 1 ||
          claim.occupancy < claim.capacity ||
          claim.retry_at !== null
        ) {
          throw new Error('claimNext: invalid machine capacity outcome');
        }
        return {
          reason: 'machine_capacity',
          occupancy: claim.occupancy,
          capacity: claim.capacity,
          retryAt: null,
        };
      }
      return null;
    }
    const d = res.data;
    const rawId = d.attributes?.drupal_internal__id;
    if (rawId === undefined || rawId === null) {
      throw new Error(`claimNext: missing drupal_internal__id on run ${d.id}`);
    }
    return {
      runUuid: d.id,
      runId: Number(rawId),
      ticketUuid: d.relationships?.ticket_id?.data?.id ?? '',
      stateAtStart: String(d.attributes?.state_at_start ?? ''),
      // handler_id was dropped; the handler is the work the run does, i.e. the
      // ticket state the run started in.
      handler: String(d.attributes?.state_at_start ?? ''),
    };
  }

  async getTicket(uuid: string): Promise<Ticket> {
    // The agent self-reads the ticket + its comments at run start (BB-112),
    // so getTicket needs no ?include=comments — but it DOES sideload labels +
    // environments (BB-144) so a config-side priority(ticket) can read them
    // without fetching (AC-5). BB-495: the dotted `project_id.group_id.
    // workspace_id` include resolves the ticket's project AND its workspace
    // in the SAME request — a `bb_project` belongs to a `bb_group` (the
    // OG group), and a `bb_group` belongs to a `bb_workspace`.
    const doc = (await this.api.get(
      `bb_ticket/bb_ticket/${uuid}?include=labels,environments,project_id.group_id.workspace_id`,
    )) as JsonApiTicketDoc;
    const attrs = doc.data?.attributes ?? {};
    const issueUrl =
      typeof attrs.origin === 'string' ? attrs.origin : undefined;
    const included = Array.isArray(doc.included) ? doc.included : [];
    const byId = new Map(included.map((r) => [`${r.type}:${r.id}`, r]));
    const refs = (name: string): JsonApiRef[] => {
      const data = doc.data?.relationships?.[name]?.data;
      return Array.isArray(data) ? data : [];
    };
    const ref = (
      source:
        | { relationships?: Record<string, { data?: unknown } | undefined> }
        | undefined,
      name: string,
    ): JsonApiRef | undefined => {
      const rel = source?.relationships?.[name]?.data;
      return rel && !Array.isArray(rel) ? (rel as JsonApiRef) : undefined;
    };
    const labels = refs('labels')
      .map((r) => byId.get(`${r.type}:${r.id}`)?.attributes?.name)
      .filter((n): n is string => typeof n === 'string');
    const environments = refs('environments')
      .map((r) => {
        const a = byId.get(`${r.type}:${r.id}`)?.attributes ?? {};
        return {
          name: typeof a.name === 'string' ? a.name : '',
          tier: typeof a.tier === 'string' ? a.tier : '',
        };
      })
      .filter((e) => e.name !== '');
    const projectRef = ref(doc.data, 'project_id');
    const project = projectRef
      ? byId.get(`${projectRef.type}:${projectRef.id}`)
      : undefined;
    const projectName =
      typeof project?.attributes?.name === 'string'
        ? project.attributes.name
        : undefined;
    const groupRef = ref(project, 'group_id');
    const group = groupRef
      ? byId.get(`${groupRef.type}:${groupRef.id}`)
      : undefined;
    const workspaceRef = ref(group, 'workspace_id');
    const workspace = workspaceRef
      ? byId.get(`${workspaceRef.type}:${workspaceRef.id}`)
      : undefined;
    const workspaceName =
      typeof workspace?.attributes?.name === 'string'
        ? workspace.attributes.name
        : undefined;
    return {
      uuid: doc.data?.id ?? uuid,
      identifier:
        typeof attrs.identifier === 'string' ? attrs.identifier : uuid,
      title: typeof attrs.title === 'string' ? attrs.title : '',
      state: typeof attrs.state === 'string' ? attrs.state : '',
      branchName:
        typeof attrs.branch_name === 'string' ? attrs.branch_name : '',
      ...(typeof attrs.base_branch === 'string' && attrs.base_branch !== ''
        ? { baseBranch: attrs.base_branch }
        : {}),
      ...(typeof attrs.effective_env_vars === 'string' &&
      attrs.effective_env_vars !== ''
        ? { effectiveEnvVars: attrs.effective_env_vars }
        : {}),
      ...(issueUrl ? { issueUrl } : {}),
      ...(projectRef ? { projectId: projectRef.id } : {}),
      ...(projectName ? { projectName } : {}),
      ...(workspaceRef ? { workspaceId: workspaceRef.id } : {}),
      ...(workspaceName ? { workspaceName } : {}),
      labels,
      environments,
    };
  }

  async getReachableWorkspaces(): Promise<string[]> {
    // BB-495: every workspace uuid the dispatching identity can reach, so
    // the agent knows the full radius it may name on a call, not only the
    // point (workspaceId) it starts on. The server's own OG read scope already
    // narrows this collection to reachable rows; 200 covers any realistic
    // membership count in one page (this is a dispatch-time convenience, not
    // an authoritative enumeration — `bakers info`'s fallback paginates fully).
    const rows = await this.api.collection('bb_workspace').page(200).list();
    return rows.map((r) => r.id);
  }

  async getRunWorktree(uuid: string): Promise<string> {
    const r = await this.api.resource('bb_run', uuid);
    return r.attr<string>('worktree_path') ?? '';
  }

  async getRunTicketIdentifier(uuid: string): Promise<string> {
    const run = await this.api.resource('bb_run', uuid);
    const ticketUuid = run.rel('ticket_id');
    if (!ticketUuid) {
      return '';
    }
    const ticket = await this.api.resource('bb_ticket', ticketUuid);
    return ticket.attr<string>('identifier') ?? '';
  }

  async getRunTicketBranchName(uuid: string): Promise<string> {
    const run = await this.api.resource('bb_run', uuid);
    const ticketUuid = run.rel('ticket_id');
    if (!ticketUuid) {
      return '';
    }
    const ticket = await this.api.resource('bb_ticket', ticketUuid);
    return ticket.attr<string>('branch_name') ?? '';
  }

  /**
   * POSTs a conductor registration to the heartbeat resource.
   *
   * Registration omits `current_load` so a startup ping cannot overwrite a
   * live process's reported load. Heartbeat supplies load and lease.
   */
  private async postHeartbeatRegistration(
    reg: ConductorRegistration,
    extras: { current_load?: number; lease_seconds?: number } = {},
  ): Promise<{
    data?: { id?: unknown; attributes?: { status?: unknown } };
  }> {
    return (await this.api.post('bakers/heartbeat', {
      data: {
        attributes: {
          conductor_id: reg.id,
          host_key: reg.host_key,
          ...(reg.machine_label ? { machine_label: reg.machine_label } : {}),
          ...(reg.adopt ? { adopt: reg.adopt } : {}),
          ...(reg.create_new ? { create_new: true } : {}),
          project: reg.project,
          states: reg.states,
          workspace_root: reg.workspace,
          label: reg.label,
          ...processIdentity(reg),
          ...(extras.current_load !== undefined
            ? { current_load: extras.current_load }
            : {}),
          ...(extras.lease_seconds !== undefined
            ? { lease_seconds: extras.lease_seconds }
            : {}),
        },
      },
    })) as {
      data?: { id?: unknown; attributes?: { status?: unknown } };
    };
  }

  async registerConductor(reg: ConductorRegistration): Promise<string> {
    let res: Awaited<ReturnType<typeof this.postHeartbeatRegistration>>;
    try {
      res = await this.postHeartbeatRegistration(reg);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 409) throw err;
      const error = (
        err.body as {
          errors?: Array<{
            detail?: unknown;
            meta?: { candidates?: Array<{ uuid?: unknown }> };
          }>;
        }
      )?.errors?.[0];
      const candidates = error?.meta?.candidates;
      // Any other 409 (concurrent registration, foreign id) is no offer.
      if (!Array.isArray(candidates)) throw err;
      throw new ConductorTakeoverRequired(
        typeof error?.detail === 'string' ? error.detail : err.message,
        candidates.flatMap((c) => (typeof c.uuid === 'string' ? [c.uuid] : [])),
      );
    }
    const id = res?.data?.id;
    if (typeof id !== 'string' || id === '') {
      throw new Error('registerConductor: heartbeat response omitted data.id');
    }
    return id;
  }

  async heartbeat(
    reg: ConductorRegistration,
    load: number,
    lease = 300,
  ): Promise<string> {
    const res = await this.postHeartbeatRegistration(reg, {
      current_load: load,
      lease_seconds: lease,
    });
    const status = res?.data?.attributes?.status;
    return typeof status === 'string' ? status : 'online';
  }

  async registerAddons(
    conductorId: string,
    definitions: Array<AddonDefinitionV2>,
  ): Promise<AddonRegistration> {
    let doc: unknown;
    try {
      doc = await this.api.post('bakers/addons', {
        data: {
          attributes: { conductor_id: conductorId, addons: definitions },
        },
      });
    } catch (err) {
      // A 422 means every addon was rejected; its body still names why.
      if (!(err instanceof HttpError) || err.status !== 422) throw err;
      doc = err.body;
    }
    const attrs = (
      doc as { data?: { attributes?: Partial<AddonRegistration> } }
    )?.data?.attributes;
    return { accepted: attrs?.accepted ?? [], rejected: attrs?.rejected ?? [] };
  }

  async fetchInbox(conductorId: string): Promise<InboxSnapshot> {
    const doc = (await this.api.get(
      `bakers/inbox/${encodeURIComponent(conductorId)}`,
    )) as {
      data?: {
        attributes?: {
          messages?: Array<{
            id: string;
            message_id: string;
            version?: string;
            ticket: string;
            payload?: Record<string, unknown> | unknown[];
            worktree_path?: string | null;
            requested_by?: string | null;
          }>;
        };
      };
    };
    const attrs = doc?.data?.attributes;
    return {
      messages: (attrs?.messages ?? []).map((m) => ({
        id: m.id,
        messageId: m.message_id,
        version: m.version ?? '',
        ticketUuid: m.ticket,
        // PHP serialises an empty object as `[]`.
        payload: Array.isArray(m.payload) ? {} : (m.payload ?? {}),
        worktreePath: m.worktree_path ?? null,
        requestedBy: m.requested_by ?? '',
      })),
    };
  }

  async writeInboxResult(
    messageUuid: string,
    status: 'running' | 'done' | 'failed',
    result?: MessageResult,
  ): Promise<void> {
    await this.api.post(`bakers/inbox/${messageUuid}/result`, {
      data: { attributes: { status, ...(result ? { result } : {}) } },
    });
  }

  async getConductorStatus(id: string): Promise<string | null> {
    const c = await this.api
      .collection('bb_conductor')
      .where('conductor_id', '=', id)
      .fields(['status'])
      .first();
    return c ? (c.attr<string>('status') ?? null) : null;
  }

  async setConductorStatus(id: string, status: 'offline'): Promise<void> {
    if (status !== 'offline') {
      throw new Error(`setConductorStatus: unsupported status "${status}"`);
    }
    const c = await this.api
      .collection('bb_conductor')
      .where('conductor_id', '=', id)
      .first();
    if (!c) {
      return;
    }
    await this.api.post(`bb_conductor/${c.id}/offline`, {
      data: { type: 'bb_conductor--bb_conductor', id: c.id },
    });
  }

  async listConductors(owner?: 'me'): Promise<ConductorStatus[]> {
    let col = this.api.collection('bb_conductor');
    if (owner === 'me') {
      col = col.where('owner_user_id.id', '=', await this.api.me());
    }
    const rows = await col.page(200).list();
    // Resolve each distinct project once rather than per row: a machine
    // typically runs several conductors of the same project.
    const projectNames = new Map<string, string>();
    // Host capacity and host_key both live on bb_machine (BB-353):
    // `bb_conductor` carries neither `max_parallel` nor `host_key` as a
    // field — `filter[host_key]` against `bb_conductor` is a 400, the field
    // does not exist there (BB-450 B7). Resolve both off the one related
    // machine, once per distinct machine rather than once per row.
    const machineDetails = new Map<
      string,
      { maxParallel: number; hostKey: string }
    >();
    for (const r of rows) {
      const projectUuid = r.rel('project_id');
      if (projectUuid && !projectNames.has(projectUuid)) {
        projectNames.set(projectUuid, await this.projectName(projectUuid));
      }
      const machineUuid = r.rel('machine');
      if (machineUuid && !machineDetails.has(machineUuid)) {
        machineDetails.set(machineUuid, await this.machineDetails(machineUuid));
      }
    }
    return rows.map((r) => {
      // Spread the optionals conditionally: an absent field must be absent,
      // not present-and-undefined (exactOptionalPropertyTypes), and a row
      // written before BB-232 legitimately carries neither.
      const pid = r.attr<number>('last_pid');
      const name = r.attr<string>('conductor_name');
      // BB-450 AC-4/B7: host_key is the related bb_machine's field, not
      // bb_conductor's — the host gate `signalVerifiedProcess()` needs had
      // no input at all without resolving it through the relationship.
      const machine = machineDetails.get(r.rel('machine') ?? '');
      const hostKey = machine?.hostKey;
      return {
        id:
          r.attr<string>('conductor_id') ??
          r.attr<string>('machine_id') ??
          r.id,
        project: projectNames.get(r.rel('project_id') ?? '') ?? '',
        label: r.attr<string>('label') ?? '',
        status: r.attr<string>('status') ?? '',
        // ISO-8601 over the wire, not the unix integer the field name implies.
        lastSeen: toUnixSeconds(r.attr('last_seen')) ?? 0,
        // Process load telemetry; host capacity is on bb_machine (BB-353).
        load:
          r.attr<number>('reported_load') ??
          r.attr<number>('current_load') ??
          0,
        workspaceRoot: r.attr<string>('workspace_root') ?? '',
        leaseExpiresAt: toUnixSeconds(r.attr('lease_expires_at')) ?? 0,
        maxParallel: machine?.maxParallel ?? 0,
        ...(typeof pid === 'number' ? { lastPid: pid } : {}),
        ...(typeof name === 'string' && name !== ''
          ? { conductorName: name }
          : {}),
        ...(typeof hostKey === 'string' && hostKey !== '' ? { hostKey } : {}),
      };
    });
  }

  async markRunning(uuid: string, attrs?: RunWriteAttributes): Promise<void> {
    const t = Math.floor(Date.now() / 1000);
    // `bb_run.started_at` is a Drupal `timestamp` field: its normalizer
    // accepts epoch seconds, ISO 8601 or RFC 3339, never a fractional-second
    // string — so a caller's `Date`/ISO-string `startedAt` is normalised to
    // whole epoch seconds here, same as `heartbeat`/`closed_date` right
    // beside it (review round 4, Critical 1).
    const startedAtSeconds =
      attrs?.startedAt === undefined
        ? undefined
        : typeof attrs.startedAt === 'number'
          ? Math.floor(attrs.startedAt)
          : Math.floor(new Date(attrs.startedAt).getTime() / 1000);
    await this.api.update('bb_run', uuid, {
      attributes: {
        state: 'running',
        heartbeat: t,
        ...(attrs?.worktree_path ? { worktree_path: attrs.worktree_path } : {}),
        ...(attrs?.agent ? { agent: attrs.agent } : {}),
        ...(startedAtSeconds !== undefined && Number.isFinite(startedAtSeconds)
          ? { started_at: startedAtSeconds }
          : {}),
      },
    });
  }

  async markFailed(uuid: string, errorLog: string): Promise<void> {
    const t = Math.floor(Date.now() / 1000);
    await this.api.update('bb_run', uuid, {
      attributes: {
        state: 'failed',
        error_log: errorLog,
        closed: true,
        closed_date: t,
      },
    });
  }

  async fetchFinalizableRuns(id: string): Promise<FinalizableRun[]> {
    // `done` and `cancelled` finalise identically: stop the agent, capture its
    // transcript, then close the run's terminal tab. Two queries are used
    // because this builder has no `IN` operator in use.
    const rows = [
      ...(await this.finalizableRunsInState(id, 'done')).map((row) => ({
        row,
        state: 'done' as const,
      })),
      ...(await this.finalizableRunsInState(id, 'cancelled')).map((row) => ({
        row,
        state: 'cancelled' as const,
      })),
    ];
    // `started_at` is read back ONLY as a transcript-selection lower bound
    // (BB-473, `AgentRunIdentity.startedAt`) for agents with no session-id
    // mechanism (codex, opencode). It is NOT used to (re)compute duration_s,
    // which stays derived from the transcript itself (BB-151).
    return rows.map(({ row: r, state }) => ({
      runUuid: r.id,
      state,
      // The `#<runId>` tab-label token: scopes the run's tab-close (BB-183).
      runId: Number(r.attr<number>('drupal_internal__id')),
      // The `after_run` context (BB-599): durable, so it survives a restart.
      ticketUuid: r.rel('ticket_id') ?? '',
      stateAtStart: r.attr<string>('state_at_start') ?? '',
      worktreePath: r.attr<string>('worktree_path') ?? '',
      agent: r.attr<string>('agent') ?? '',
      startedAt: r.attr<string>('started_at') ?? '',
    }));
  }

  private async finalizableRunsInState(id: string, state: string) {
    return this.api
      .collection('bb_run')
      .where('conductor_id.conductor_id', '=', id)
      .where('state', '=', state)
      .where('closed', '=', '0')
      .fields([
        'worktree_path',
        'agent',
        'drupal_internal__id',
        'started_at',
        'state_at_start',
        'ticket_id',
      ])
      .page(100)
      .list();
  }

  async finalizeRun(
    uuid: string,
    log: string,
    metrics?: RunMetrics,
  ): Promise<void> {
    const t = Math.floor(Date.now() / 1000);
    const close = {
      closed: true,
      closed_date: t,
      ...(metrics ?? {}),
    };
    try {
      await this.api.update('bb_run', uuid, {
        attributes: {
          ...close,
          ...(log ? { log } : {}),
        },
      }); // NO state — the run is already done.
    } catch (err) {
      if (!(err instanceof RunLogSizeError)) {
        throw err;
      }
      await this.closeOmittingOversizeLog(uuid, close);
    }
  }

  /**
   * Closes the run without the transcript after a recognized size rejection.
   *
   * A lost fallback response is reconciled by reading `closed` and must not
   * send a third write.
   */
  private async closeOmittingOversizeLog(
    uuid: string,
    close: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.api.update('bb_run', uuid, {
        attributes: {
          ...close,
          log_upload_omitted: true,
        },
      });
    } catch (err) {
      if (err instanceof HttpError && err.status !== 0) {
        throw err;
      }
      if (await this.runIsClosed(uuid)) {
        return;
      }
      throw err;
    }
  }

  private async runIsClosed(uuid: string): Promise<boolean> {
    try {
      const run = await this.api.resource('bb_run', uuid);
      return Boolean(run.attr('closed'));
    } catch {
      return false;
    }
  }

  async fetchUncleanedTickets(id: string): Promise<UncleanTicket[]> {
    // Closed tickets whose worktree is not yet torn down, scoped to this
    // conductor (BB-121): only tickets assigned to `id` are loaded, so a
    // ticket owned by another conductor never reaches the reaper loop. Since
    // BB-451 the server closes every terminal ticket on its own save
    // (BbTicket::preSave()), so this asks one question — closed but not
    // cleaned up — with no workflow-state reasoning left in it. `cleaned_up`
    // is nullable and an unwritten Drupal boolean is NULL, and `NULL = 0`
    // matches nothing in SQL, so the NULL twin is a second query rather than a
    // looser operator (BB-364 D1, absorbed here). The collection builder has
    // no OR across DIFFERENT conditions on the same field, so the two stay
    // separate AND-queries merged + de-duped by uuid. The `conductor_id`
    // relationship carries the assigned conductor's `machine_id` — the same
    // nested filter the sibling reaper queries (`fetchFinalizableRuns` etc.)
    // use.
    const fields = ['branch_name', 'state', 'base_branch', 'links'];
    const uncleaned = await this.api
      .collection('bb_ticket')
      .where('conductor_id.conductor_id', '=', id)
      .where('closed', '=', '1')
      .where('cleaned_up', '=', '0')
      .fields(fields)
      .page(100)
      .list();
    const neverWritten = await this.api
      .collection('bb_ticket')
      .where('conductor_id.conductor_id', '=', id)
      .where('closed', '=', '1')
      .notExists('cleaned_up')
      .fields(fields)
      .page(100)
      .list();
    const byUuid = new Map<string, (typeof uncleaned)[number]>();
    for (const r of [...uncleaned, ...neverWritten]) {
      byUuid.set(r.id, r);
    }
    return Promise.all(
      [...byUuid.values()].map(async (r) => ({
        ticketUuid: r.id,
        branchName: r.attr<string>('branch_name') ?? '',
        state: r.attr<string>('state') ?? '',
        baseBranch: r.attr<string>('base_branch') ?? '',
        // Same rule as the server's LinkKind::fromUri(): the URI, not the title.
        hasMr: (r.attr<{ uri?: string }[]>('links') ?? []).some((l) =>
          (l.uri ?? '').includes('/-/merge_requests/'),
        ),
        ...(await this.latestRun(r.id)),
      })),
    );
  }

  async fetchFrozenTickets(id: string): Promise<FrozenTicket[]> {
    // Same conductor scope as the reaper. `frozen` is NOT NULL (the server
    // stores a written null as FALSE), so one equality query is complete.
    // ponytail: one page (JSON:API caps it at 50), sorted so the window is
    // stable; past 50 frozen tickets per conductor the rest get no hooks.
    // Follow links.next if a conductor ever holds that many.
    const rows = await this.api
      .collection('bb_ticket')
      .where('conductor_id.conductor_id', '=', id)
      .where('closed', '=', '0')
      .where('frozen', '=', '1')
      .fields(['identifier'])
      .sort('drupal_internal__id')
      .page(100)
      .list();
    return Promise.all(
      rows.map(async (r) => ({
        ticketUuid: r.id,
        identifier: r.attr<string>('identifier') ?? r.id,
        worktreePath: (await this.latestRun(r.id)).worktreePath,
      })),
    );
  }

  async replaceTicketMetrics(
    uuid: string,
    namespace: string,
    rows: TicketMetric[],
  ): Promise<void> {
    const doc = (await this.api.get(
      `bb_ticket/bb_ticket/${uuid}?fields[bb_ticket--bb_ticket]=metrics`,
    )) as { data?: { attributes?: { metrics?: TicketMetric[] } } };
    const kept = (doc.data?.attributes?.metrics ?? []).filter(
      (m) => !m.name.startsWith(namespace),
    );
    await this.api.update('bb_ticket', uuid, {
      attributes: { metrics: [...kept, ...rows] },
    });
  }

  async markTicketCleanedUp(uuid: string): Promise<void> {
    await this.api.update('bb_ticket', uuid, {
      attributes: { cleaned_up: true },
    }); // NO state/closed — teardown flag only, decoupled from the lifecycle.
  }

  /**
   * UUID + absolute worktree path of the ticket's latest run (highest run id
   * with a non-empty worktree_path), or empty strings when none — the cwd the
   * cleanup command runs in, plus the record its teardown is noted on
   * (BB-293). The conductor persists worktree_path on markRunning, so a done
   * ticket's run carries the path even after the run closed.
   *
   * The uuid rides along on the query that already resolves the path, so the
   * reaper learns which run to write to at no extra round-trip.
   */
  private async latestRun(
    ticketUuid: string,
  ): Promise<{ runUuid: string; worktreePath: string }> {
    const rows = await this.api
      .collection('bb_run')
      .where('ticket_id.id', '=', ticketUuid)
      .fields(['worktree_path', 'drupal_internal__id'])
      .sort('-drupal_internal__id')
      .page(100)
      .list();
    for (const r of rows) {
      const path = r.attr<string>('worktree_path');
      if (path) {
        return { runUuid: r.id, worktreePath: path };
      }
    }
    return { runUuid: '', worktreePath: '' };
  }

  async appendRunNote(runUuid: string, note: string): Promise<void> {
    if (!runUuid) {
      return; // no run to record anything on
    }
    // Confirm the run exists first, exactly as before: an unreadable run must
    // refuse rather than let `fetchRunLog` treat a 404 caused by a missing run
    // the same way it treats a fresh run with no transcript yet.
    const run = await this.api
      .collection('bb_run')
      .where('id', '=', runUuid)
      .fields(['id'])
      .first();
    if (!run) {
      // Refuse rather than guess. With no row read, `existing` below would be ''
      // and the PATCH would REPLACE the transcript with this one diagnostic
      // line — destroying exactly what the note exists to preserve. An
      // unreadable run is the reaper's best-effort catch (it warns and still
      // flags the ticket), never a silent truncation.
      throw new Error(
        `bb_run ${runUuid} could not be read — run note not written`,
      );
    }
    // BB-556: the JSON:API `log` attribute is ALWAYS empty on a reload —
    // `BbRun::preSave()` moves any payload to a file and clears the field —
    // so the real current transcript can only be read through the download
    // route. A run with no transcript yet (or whose file 404s) reads as ''.
    const existing = await this.fetchRunLog(runUuid);
    await this.api.update('bb_run', runUuid, {
      attributes: { log: existing ? `${existing}\n${note}` : note },
    }); // NO state/closed — the run is already closed.
  }

  async resolveTicketByIdentifier(
    project: string,
    identifier: string,
  ): Promise<{ uuid: string; title: string } | null> {
    // Scope by the project uuid: identifiers (bakers.build-nnn) are unique per project,
    // not globally, so a bare identifier filter could match another project's
    // ticket in a multi-project instance.
    const projectId = await this.projectUuid(project);
    const t = await this.api
      .collection('bb_ticket')
      .where('identifier', '=', identifier)
      .where('project_id.id', '=', projectId)
      .first();
    if (!t) {
      return null;
    }
    return { uuid: t.id, title: t.attr<string>('title') ?? '' };
  }

  private readonly projectUuidCache = new Map<string, string>();

  /**
   * The project *name* behind a project uuid — the inverse of projectUuid.
   *
   * A conductor row references its project; the CLI and the cockpit want to
   * show the name. Best-effort: an unreadable project must not fail a listing,
   * so it degrades to '' and the row still renders.
   */
  private async projectName(uuid: string): Promise<string> {
    try {
      const p = await this.api.resource('bb_project', uuid);
      return p.attr<string>('name') ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Host concurrent-run budget and `host_key` for a machine uuid (BB-353,
   * BB-450). Both live on `bb_machine`, never on `bb_conductor`.
   *
   * Best-effort: an unreadable or missing machine degrades to
   * `{maxParallel: 0, hostKey: ''}` so the row still lists; capacity and
   * identity are never invented from a conductor field.
   */
  private async machineDetails(
    uuid: string,
  ): Promise<{ maxParallel: number; hostKey: string }> {
    try {
      const m = await this.api.resource('bb_machine', uuid);
      return {
        maxParallel: m.attr<number>('max_parallel') ?? 0,
        hostKey: m.attr<string>('host_key') ?? '',
      };
    } catch {
      return { maxParallel: 0, hostKey: '' };
    }
  }

  private async projectUuid(name: string): Promise<string> {
    // A project's name→uuid never changes, so cache it: gatherBatch resolves
    // many identifiers per `bakers deployment tickets` call, each of which would
    // otherwise re-fetch the same project.
    const cached = this.projectUuidCache.get(name);
    if (cached) {
      return cached;
    }
    if (this.selection?.project === name && this.resolvedProjectId) {
      this.projectUuidCache.set(name, this.resolvedProjectId);
      return this.resolvedProjectId;
    }
    if (this.selection?.project === name) {
      const context = await resolveBbProjectContext(this.api, this.selection);
      this.projectUuidCache.set(name, context.projectId);
      return context.projectId;
    }
    // BB-472: bb_project.name carries no uniqueness constraint, so a plain
    // `.first()` was an arbitrary pick with no error and no log line. Read up
    // to 2 rows instead — enough to detect "more than one" without paging the
    // whole table — and fail loudly rather than guess.
    const rows = await this.api
      .collection('bb_project')
      .where('name', '=', name)
      .page(2)
      .list();
    if (rows.length === 0) {
      throw new Error(`bakers project "${name}" not found`);
    }
    if (rows.length > 1) {
      throw new AmbiguousProjectNameError(
        `bakers project "${name}" is ambiguous: at least ${rows.length} projects share this name. Name a workspace to disambiguate.`,
      );
    }
    const id = rows[0]?.id ?? '';
    this.projectUuidCache.set(name, id);
    return id;
  }
}

export function drupalRemote(): RemotePlugin {
  return {
    kind: 'remote',
    id: 'drupal',
    requiredModules: [],
    async createRemote(config: ConductorFileConfig) {
      // BB-472: build the client through the SAME connection plugin chain
      // every other CLI surface runs (auth + alterRequest over
      // `config.plugins`), instead of assembling a second, plugin-less client
      // here. Without this, a configured `@bakers-build/addon-workspace` (or any
      // other alterRequest plugin) was inert for the conductor's own remote —
      // a configuration that reads correctly and does nothing.
      const context = await createBbConnectionContext(
        {
          site: config.site,
          plugins: config.plugins ?? [],
        },
        {
          http: createRunLogHttp(
            config.site.base_url,
            config.site.jsonapi_prefix,
          ),
        },
      );
      return new DrupalBbRemote(
        context.client,
        config.bakers,
        config.resolved_bakers?.projectId,
        createRunLogFetcher(context.http, context.auth, context.baseUrl),
      );
    },
  };
}

export default drupalRemote;
