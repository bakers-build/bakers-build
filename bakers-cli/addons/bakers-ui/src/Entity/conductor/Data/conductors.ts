// BB-236 — the CONDUCTOR data service. It returns CONDUCTORS and knows nothing
// about forms: no `Option`, no project filter, no `(status)` in a label. Those are
// one popup's rules and live with that popup's adapter (`edit-form-data.ts`); a
// service that applied them would be unusable for any other purpose. The two read
// strategies are both just reading, so both live here.
import { toUnixSeconds } from '@bakers-build/core';
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { humanizeAge } from '../../../lib/format.js';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
  Resource,
} from '../../../types.js';
import {
  type JsonApiCollectionDoc,
  type ListTable,
  loadPage,
  type Page,
  type PageWindow,
} from '../../collection.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import {
  type ListOutcome,
  listOutcome,
  listPreferringWrite,
  messageOf,
  type OptionClients,
} from '../../transport.js';
import { type ConductorStatus, deriveConductorStatus } from './liveness.js';

/** One conductor of the control plane, as this renderer needs it. */
export interface Conductor {
  id: string;
  /** Never empty — the uuid is the last fallback, so nothing renders as blank. */
  label: string;
  /** The machine the conductor runs on. */
  machineId: string | undefined;
  /** Liveness, as the control plane reports it. */
  status: string | undefined;
  /** Operator-set lifecycle flag; inactive conductors are never assignable. */
  active: boolean;
  /** The conductor's project, `null` when unlinked. */
  projectId: string | null;
  /** The user who owns this record, `null` when unowned (BB-460 D8/D9). */
  ownerUserId: string | null;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const toConductor = (r: Resource): Conductor => ({
  id: r.id,
  label:
    str(r.attr('label')) ??
    str(r.attr('conductor_id')) ??
    str(r.attr('machine_id')) ??
    r.id,
  // Registration key (BB-353 renamed machine_id → conductor_id).
  machineId: str(r.attr('conductor_id')) ?? str(r.attr('machine_id')),
  status: str(r.attr('status')),
  active: r.attr('active') !== false,
  projectId: r.rel('project_id'),
  ownerUserId: r.rel('owner_user_id'),
});

/**
 * The conductor collection through one client, in server order.
 *
 * Yields the OUTCOME rather than a swallowed array (BB-257 D4) — see the same
 * note on `listUsers`. `listConductorsPreferringWrite` keeps the swallowing
 * contract, because it already answers a failure by falling back.
 */
export const listConductors = (
  client: DropshClient,
): Promise<ListOutcome<Conductor>> =>
  listOutcome(client, 'bb_conductor', toConductor);

/**
 * The conductor collection scoped to one project (BB-664 review F4).
 *
 * The create popup's narrow option loader, not `ConductorQuery`'s row-page
 * read above (BB-664 plan correction): this keeps `listOutcome`'s own
 * outcome/error contract rather than inventing a second one for the same
 * entity. An unscoped caller keeps calling {@link listConductors}; this is
 * additive.
 */
export const listConductorsForProject = async (
  client: DropshClient,
  projectId: string,
): Promise<ListOutcome<Conductor>> => {
  try {
    return {
      rows: (
        await client
          .collection('bb_conductor')
          .where('project_id.id', '=', projectId)
          .list()
      ).map(toConductor),
    };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
};

/**
 * The same collection read through the WRITE client where there is one — still just
 * reading, but the write scope is the one that decides what a write may reference,
 * and `pm` sees the FULL conductor set where `session` sees a subset.
 */
export const listConductorsPreferringWrite = (
  clients: OptionClients,
): Promise<Conductor[]> =>
  listPreferringWrite(clients, 'bb_conductor', toConductor);

// BB-232 — the Conductors screen's read. It extends this service rather than
// forking a second one: same entity, same client, one more projection.

/** A conductor as the Conductors screen renders it. */
export interface ConductorRow extends Conductor {
  /** The `.bakers` dir it last registered from; '' when it never reported one. */
  workspaceRoot: string;
  /** Unix seconds of the last heartbeat; 0 when it never reported one. */
  lastSeen: number;
  /** Unix seconds the lease runs out; 0 when unset. */
  leaseExpiresAt: number;
  currentLoad: number;
  maxParallel: number;
  /** The pid its serve loop last reported, if any. */
  lastPid: number | undefined;
  /** The config stem it was started from, as `--conductor <name>` takes it. */
  conductorName: string | undefined;
  /**
   * The MachineContext host stem this record last heartbeat with (BB-450
   * AC-4/B7) — what a stop compares against this machine's own before
   * signalling. Resolved from the related `bb_machine` (`host_key` is that
   * entity's field, never `bb_conductor`'s), never from the conductor row
   * itself.
   */
  hostKey: string | undefined;
  /** Liveness, derived — never the raw `status`. */
  derivedStatus: ConductorStatus;
  /**
   * Whether this conductor's workspace exists on THIS machine.
   *
   * The control plane is user-scoped, not machine-scoped, so a user's other
   * machines' conductors appear in this list. They are shown rather than
   * hidden — filtering by machine_id would mean substring-matching a composed
   * string. This is a FILESYSTEM fact only (used to decide whether the log
   * tail can read a local file); it is not an identity gate — see {@link mine}
   * for that.
   */
  isLocal: boolean;
  /**
   * Whether this row's `hostKey` matches THIS machine's own (BB-450 B10) —
   * the identity gate for starting/stopping and for the view-only marking.
   *
   * Deliberately distinct from {@link isLocal}: two `bb_conductor` records
   * can name the SAME `workspace_root` under different machines (BB-281
   * Finding 2), which makes `isLocal` true for both — a path is not proof of
   * identity, which is the whole thesis this ticket is built on. `false` when
   * `hostKey` is absent (a record from before BB-450, or an unreadable
   * machine): an unproven identity is never treated as this machine's own.
   */
  mine: boolean;
}

/**
 * Shorten a value from the LEFT, keeping its end — and the ONE exception to
 * this ticket's "free text grows" rule (BB-345 D10).
 *
 * A CONTENT decision, which is why it is a cell accessor and not a layout
 * member: a cell's `truncate` can only drop the RIGHT, and both values it is
 * applied to carry their distinguishing part in the TAIL. A composed
 * `machine_id` is `${user_id}-${machine_id}-${project}`, so every row of a
 * user-scoped control plane repeats the same user uuid at the head; conductor
 * workspaces all share `/home/<user>/projects/…`. Eliding the right would leave
 * every row looking identical.
 *
 * THAT IS WHY `MACHINE` AND `WORKSPACE` KEEP FIXED BUDGETS while `NAME` grows.
 * Making either a grower would hand its cut back to the renderer's
 * right-truncation — head kept, tail dropped — which is strictly worse than
 * today and loses the exact information this function exists to preserve. A
 * grower also declares no width for this to cut against: `elideLeft` marks its
 * cut with a leading `…` precisely because it is told, in advance, how many
 * columns it has.
 */
const elideLeft = (value: string, width: number): string =>
  value.length <= width ? value : `…${value.slice(value.length - (width - 1))}`;

/** How much width the machine_id column gets before {@link elideLeft} cuts it. */
const MACHINE_ID_WIDTH = 20;
/**
 * The same, for the workspace path column — and the column that PAYS for this
 * list fitting the cockpit's own default terminal.
 *
 * 30 made the row want 126 columns (NAME's floor 20, MACHINE 20, PROJECT 14,
 * STATUS 9, AGE 8, WORKSPACE 30, PID 7, MARKS 11, plus seven separators) while
 * `bakers ui` opens at 120, so the terminal cut the LAST column: measured on a
 * real pty, the header ended `PID     MAR` and a non-local conductor's
 * `elsewhere` came out `elsew`. BB-345 brought it to 24, fitting exactly 120.
 *
 * BB-450 AC-7 spent six of those back: adding `LOAD` (its own 5-wide budget
 * plus the separator every column past the first pays) reopened the same
 * 126-column overrun this constant exists to close, so `WORKSPACE` pays the
 * same six columns again — 18, not 24 — to keep the row at exactly 120.
 *
 * WHY THIS COLUMN GIVES THE SIX. `WORKSPACE` is the only column in the row whose
 * cut is free: it is elided from the LEFT, so it loses six columns of the HEAD —
 * the `/home/<user>/projects/…` prefix every conductor workspace on a machine
 * shares — and keeps the distinguishing tail either way. Every other column
 * would pay in information: `MACHINE` elides left too but is already the
 * narrower of the pair, the three closed vocabularies (and `LOAD`'s fixed
 * ratio) are sized to their own longest member, and `NAME`/`PROJECT` are the
 * growers this ticket widened.
 *
 * A DECLARED BUDGET, never a measurement (spec D4). 18 is not the width of
 * anyone's path — no page's data is consulted to arrive at it, so the columns do
 * not move when the list does. It is shared by the column's `width` and by the
 * {@link elideLeft} its accessor applies for exactly that reason: two numbers
 * could drift, and a marker cut at one width inside a cell laid out at another
 * is the defect the single constant makes unspellable.
 */
const PATH_WIDTH = 18;

/** What a conductor ROW cannot know on its own, handed to the columns per frame. */
export interface ConductorListContext {
  /** The clock the AGE column reads — one `now` for the whole frame. */
  readonly nowSeconds: number;
  /** The conductors with an action in flight, so a second keypress reads as
   *  visibly redundant. */
  readonly busyIds: ReadonlySet<string>;
  /** Project uuid → name, from the screen's own small read. */
  readonly projectNames: ReadonlyMap<string, string>;
}

/**
 * The conductors list, declared once (BB-345 D2/D10) — its nine columns, the
 * noun every one of its node ids is prefixed with, and what it says when it is
 * empty.
 *
 * It GAINED A HEADER with this ticket (D6). This is the list a header earns its
 * keep in most: nine columns of ids, paths and numbers are not self-describing
 * the way three named ones were. The consequence is stated because it is a
 * behaviour change — the list grows one row at the top and its selection
 * highlight moves down one physical row. Nothing computes that offset:
 * selection is a node attribute and the cursor is found through `rowIds`, both
 * of which BB-340 made position-free.
 *
 * `fields` names what each column is built from, as everywhere. This loader
 * reads the whole `bb_conductor` collection with no sparse fieldset, so there
 * is no `AssertExhaustive` proof binding these — declaring them anyway keeps
 * that a fact about this loader rather than a hole in the column model.
 *
 * WHICH COLUMNS GROW, AND WHY THOSE TWO. The rule is the operator's and it is
 * about the CONTENT: a free-text column grows. `NAME` and `PROJECT` are the two
 * here — a conductor's label and a project's name are operator-written prose
 * with no vocabulary and no shared head, so both benefit from a surplus and
 * neither loses anything to Yoga's right-hand cut. They SHARE it through
 * `grow`, which is what the mechanism exists for, and the shares are 2 : 1 in
 * `NAME`'s favour: the label is the row's identity and the column an operator
 * reads first, while the project name is a secondary attribute that repeats
 * across every row of one project. `PROJECT` keeps its 14 as its BASIS rather
 * than as a bound, so a narrow terminal leaves it exactly the columns it had
 * before this ticket and a wide one hands it a share.
 *
 * The other seven do not grow, and each for its own reason. `MACHINE` and
 * `WORKSPACE` are free text too, and are the ONE exception to the rule: they
 * are elided from the LEFT (see {@link elideLeft}), which needs a declared
 * width to cut against and keeps the distinguishing tail — a grower would hand
 * the cut back to the renderer's right-hand clip and lose exactly what that
 * elision preserves. `STATUS`, `AGE` and `PID` are closed vocabularies that
 * cannot use a surplus at all. `MARKS` is a closed vocabulary too and keeps a
 * real budget for a measured reason: `width: 0, grow: 0` collapses it to zero
 * columns and the mark vanishes. `LOAD` (BB-450 AC-7) is a fixed `<current>/
 * <max>` ratio, not free text, so it takes a budget rather than a share too.
 */
export const CONDUCTOR_TABLE = {
  noun: 'conductor',
  emptyMessage: 'No conductors on this control plane.',
  columns: [
    {
      /**
       * A GROWER — free text, right-truncated, and the column an operator reads
       * first. Declared FIRST and growing all the same: `flexGrow` is a
       * property of the cell, not of its position in the row (measured, spec
       * R2). Its `grow: 2` against `PROJECT`'s 1 is the identity column's larger
       * claim on the surplus, argued above.
       *
       * `min: 20` is the ONE floor on this list, and it is preservation rather
       * than invention: 20 is the budget this column has carried since
       * BB-232, and without it a narrow terminal squeezes the grower to
       * nothing while seven fixed budgets keep theirs — measured at 80 columns,
       * NAME came out ONE column wide and the label read `c…`. The other seven
       * columns need 106 columns between them, so below ~126 the row runs past
       * the right edge and the renderer clips it there. That is exactly what
       * this list did before this ticket, at every width; the floor keeps the
       * narrow case as it was and lets the wide case improve.
       */
      key: 'name',
      label: 'NAME',
      width: 0,
      min: 20,
      grow: 2,
      fields: ['label', 'machine_id'],
      get: (row: ConductorRow) =>
        row.label !== '' ? row.label : (row.machineId ?? ''),
    },
    {
      // Its OWN column, not merely the label's fallback (BB-232 AC-1): two
      // conductors of one repo share a project and a workspace_root, and the
      // machine_id is the only thing that separates them.
      key: 'machine',
      label: 'MACHINE',
      width: MACHINE_ID_WIDTH,
      fields: ['machine_id'],
      get: (row: ConductorRow) =>
        elideLeft(row.machineId ?? '', MACHINE_ID_WIDTH),
    },
    {
      /**
       * A project NAME, so free text, so a GROWER — the operator's correction to
       * Task 6, which shipped this column fixed at 14 and named the cut an
       * accepted residual. Measured at 160 columns with that configuration: 15
       * columns unused at the right edge while an ordinary project name was cut
       * to `keytec-bakers-p…`, which is finding 3 of this very ticket reproduced
       * one column further left.
       *
       * The 14 stays as the flex BASIS, not as a bound: it is what the column
       * starts from and what a terminal too narrow to give anything leaves it,
       * so the narrow case is unchanged and only the wide one improves. No
       * `min`, deliberately — without one the cell keeps `flexShrink: 0` and an
       * overflowing row takes its columns from `NAME`, whose `min: 20` is the
       * floor this list has always had.
       */
      key: 'project',
      label: 'PROJECT',
      width: 14,
      grow: 1,
      fields: ['project_id'],
      get: (row: ConductorRow, ctx: ConductorListContext) =>
        row.projectId ? (ctx.projectNames.get(row.projectId) ?? '') : '',
    },
    {
      /** A CLOSED VOCABULARY. `ConductorStatus`'s reachable members here are
       *  `online | stale | offline` — this screen can never produce
       *  `registry-only`, because every row IS a control-plane record — and an
       *  inactive row appends a trailing `!`, whose longest, `offline!`, is 8,
       *  so 9 still shows each of them whole (BB-542 N1: `(inactive)` does
       *  not fit this budget without disturbing every other column's exact
       *  width, so the marker is a glyph rather than a word). */
      key: 'status',
      label: 'STATUS',
      width: 9,
      fields: ['status', 'active', 'lease_expires_at', 'last_seen'],
      get: (row: ConductorRow) =>
        row.active ? row.derivedStatus : `${row.derivedStatus}!`,
    },
    {
      /** `humanizeAge`'s own vocabulary, exactly as on the projects list: `—`,
       *  `just now`, `<n>m|h|d ago`. 8 is the longest of them. */
      key: 'age',
      label: 'AGE',
      width: 8,
      fields: ['last_seen'],
      get: (row: ConductorRow, ctx: ConductorListContext) =>
        humanizeAge(row.lastSeen || null, ctx.nowSeconds),
    },
    {
      key: 'workspace',
      label: 'WORKSPACE',
      width: PATH_WIDTH,
      fields: ['workspace_root'],
      get: (row: ConductorRow) => elideLeft(row.workspaceRoot, PATH_WIDTH),
    },
    {
      /** A pid is at most 7 digits — Linux's `pid_max` ceiling is 4 194 304 —
       *  and a conductor that never reported one shows `-` rather than a
       *  fabricated number. */
      key: 'pid',
      label: 'PID',
      width: 7,
      fields: ['last_pid'],
      get: (row: ConductorRow) =>
        row.lastPid === undefined ? '-' : String(row.lastPid),
    },
    {
      /**
       * A closed vocabulary too, which is why it takes a budget instead of the
       * trailing slot it used to hold: everything it can say is `…`,
       * `elsewhere` or both, and 11 is `… elsewhere`.
       *
       * A conductor that is not MINE is MARKED rather than hidden. The control
       * plane is user-scoped, not machine-scoped, so a user's other machines'
       * conductors are legitimately in this list — and silently dropping them
       * would make the cockpit disagree with `bakers oven ls` for no visible
       * reason. The mark says why their actions are inert here: an identity
       * that is not this machine's own (BB-450 B10 — `mine`, not `isLocal`'s
       * path check, since two records can share one `workspace_root` under
       * different machines).
       */
      key: 'marks',
      label: 'MARKS',
      width: 11,
      fields: ['workspace_root'],
      get: (row: ConductorRow, ctx: ConductorListContext) =>
        [ctx.busyIds.has(row.id) ? '…' : '', row.mine ? '' : 'elsewhere']
          .filter((mark) => mark !== '')
          .join(' '),
    },
    {
      /**
       * `<current>/<max>` (BB-450 AC-7) — the utilization `capacityOf()`
       * already computes from the sideloaded machine, reaching the row but no
       * column until this one. 5 fits every realistic pair (`max_parallel` is
       * a small hand-set integer); a triple-digit load would overflow it, and
       * that is a capacity-planning problem this list only reports, not one
       * this column need budget for.
       */
      key: 'load',
      label: 'LOAD',
      width: 5,
      fields: ['current_load', 'max_parallel'],
      get: (row: ConductorRow) => `${row.currentLoad}/${row.maxParallel}`,
    },
  ],
} as const satisfies ListTable<ConductorRow, ConductorListContext>;

/**
 * The project-scoped Conductors tab's table (BB-450 D13) — the SAME column
 * definitions as {@link CONDUCTOR_TABLE}, minus `project`: every row is
 * already this one project's, so the column would repeat one value down the
 * whole list. No new component or column is declared; this reuses the exact
 * objects, so the two lists cannot drift out of step with each other.
 */
export const PROJECT_CONDUCTOR_TABLE = {
  ...CONDUCTOR_TABLE,
  columns: CONDUCTOR_TABLE.columns.filter((column) => column.key !== 'project'),
} as const satisfies ListTable<ConductorRow, ConductorListContext>;

/** What the row projection needs from the outside world, injected for tests. */
export interface ConductorRowContext {
  /** Unix seconds; the liveness derivation's clock. */
  now: number;
  /** Whether a path exists on this machine. */
  exists: (path: string) => boolean;
  /**
   * THIS machine's own `host_key` (BB-450 B10), resolved once by the caller
   * before the read — the same MachineContext value `signalVerifiedProcess`
   * and the CLI's `hostKeyOf(config)` compare against. Compared against each
   * row's own `hostKey` to derive {@link ConductorRow.mine}.
   */
  thisHostKey: string;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Id of a single-valued relationship linkage (`data` object), or null. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

/**
 * Dropsh's collection path hands Resource accessors; the cockpit row path uses
 * client.get so it can sideload `machine`. Map the raw JSON:API resource into
 * the same attr/rel surface toConductor already speaks.
 */
function asResource(raw: JsonApiResource): Resource {
  return {
    id: raw.id ?? '',
    type: raw.type ?? '',
    attr: (key: string) => raw.attributes?.[key],
    rel: (key: string) => singleRelId(raw.relationships?.[key]),
    rels: (key: string) => {
      const data = raw.relationships?.[key]?.data;
      if (!data) return [];
      if (Array.isArray(data)) {
        return data
          .map((d) => d.id)
          .filter((id): id is string => typeof id === 'string');
      }
      return data.id ? [data.id] : [];
    },
  };
}

/** Host capacity from the sideloaded machine, with cutover fallbacks (BB-353). */
function capacityOf(
  raw: JsonApiResource,
  machinesById: Map<string, JsonApiResource>,
): { currentLoad: number; maxParallel: number } {
  const machineId = singleRelId(raw.relationships?.machine);
  const machine = machineId ? machinesById.get(machineId) : undefined;
  const attrs = raw.attributes ?? {};
  return {
    // Prefer machine.current_load; process telemetry / legacy conductor attrs
    // only when the host row is missing during cutover.
    currentLoad:
      num(machine?.attributes?.current_load) ??
      num(attrs.reported_load) ??
      num(attrs.current_load) ??
      0,
    // max_parallel is machine-owned SoT; legacy conductor attr is last resort.
    maxParallel:
      num(machine?.attributes?.max_parallel) ?? num(attrs.max_parallel) ?? 0,
  };
}

/**
 * `host_key` from the sideloaded machine (BB-450 B7) — `bb_conductor`
 * carries no such field at all; `filter[host_key]` against it is a
 * server-side 400. Reading `raw.attributes.host_key` here would repeat the
 * exact defect the CLI's `listConductors()` had: always `undefined` in
 * reality, present only in a fixture that hand-writes it on the wrong entity.
 */
function hostKeyOf(
  raw: JsonApiResource,
  machinesById: Map<string, JsonApiResource>,
): string | undefined {
  const machineId = singleRelId(raw.relationships?.machine);
  const machine = machineId ? machinesById.get(machineId) : undefined;
  return str(machine?.attributes?.host_key);
}

const toConductorRow = (
  raw: JsonApiResource,
  ctx: ConductorRowContext,
  machinesById: Map<string, JsonApiResource>,
): ConductorRow => {
  const r = asResource(raw);
  const workspaceRoot = str(r.attr('workspace_root')) ?? '';
  // ISO-8601 over the wire, not the unix integer the field name implies — a
  // `typeof === 'number'` guard here is what made a live conductor read `stale`.
  const lastSeen = toUnixSeconds(r.attr('last_seen')) ?? 0;
  const leaseExpiresAt = toUnixSeconds(r.attr('lease_expires_at')) ?? 0;
  const { currentLoad, maxParallel } = capacityOf(raw, machinesById);
  const hostKey = hostKeyOf(raw, machinesById);
  return {
    ...toConductor(r),
    workspaceRoot,
    lastSeen,
    leaseExpiresAt,
    currentLoad,
    maxParallel,
    lastPid: num(r.attr('last_pid')),
    conductorName: str(r.attr('conductor_name')),
    hostKey,
    // `present: true` because the row IS a control-plane record — which is why
    // `registry-only` can never come out of this screen.
    derivedStatus: deriveConductorStatus(
      {
        present: true,
        status: str(r.attr('status')) ?? null,
        lastSeen: lastSeen === 0 ? null : lastSeen,
        leaseExpiresAt: leaseExpiresAt === 0 ? null : leaseExpiresAt,
      },
      ctx.now,
    ),
    // A conductor that never reported a workspace cannot be local, whatever the
    // filesystem would say about an empty path.
    isLocal: workspaceRoot !== '' && ctx.exists(workspaceRoot),
    // BB-450 B10: an absent hostKey is never waved through as "mine" — an
    // unproven identity is refused, the same rule signalVerifiedProcess uses.
    mine: hostKey !== undefined && hostKey === ctx.thisHostKey,
  };
};

/** What narrows a conductor read — both filters AND together in one query. */
export interface ConductorQuery {
  /** The project's own conductors (BB-450 D13). */
  projectId?: string | undefined;
  /** The conductors this user OWNS (BB-460 D3) — by owner, never by machine. */
  ownerUserId?: string | undefined;
}

/**
 * The query both reads share: the narrowing, the declared order, the sideload.
 *
 * `sort=-last_seen,-drupal_internal__id` is not cosmetic (BB-460 D7,
 * BB-458 AC-2). Paging over a collection with no total order lets a row
 * repeat on two pages while another is skipped entirely, so the order is a
 * correctness property of the paging before it is a convenience for the reader.
 * `last_seen` is nullable and two conductors can share a heartbeat; the serial
 * id is the unique second key that makes offset paging well defined.
 */
const conductorParams = (query: ConductorQuery): DrupalJsonApiParams => {
  const params = new DrupalJsonApiParams().addInclude(['machine']);
  params.addSort('last_seen', 'DESC');
  params.addSort('drupal_internal__id', 'DESC');
  if (query.projectId) params.addFilter('project_id.id', query.projectId);
  if (query.ownerUserId)
    params.addFilter('owner_user_id.id', query.ownerUserId);
  return params;
};

/**
 * One PAGE of the conductor collection as cockpit rows (BB-460 D6).
 *
 * Sideloads `machine` so capacity (BB-353 D5/D10) comes from the host budget.
 * The owner filter rides this same query rather than the returned rows (D3):
 * applied to an already-bounded page it would hide BB-458's truncation instead
 * of fixing it.
 *
 * A FAILED READ PROPAGATES, and that is the change D6 buys rather than an
 * oversight. The read this replaced swallowed a failure into an empty list, so
 * one failed 5 s poll left the screen navigable; on the shared `ListScreen`
 * base a rejected load is the error state every other bakers.build list already shows,
 * and one collection may not keep a second spelling of what a failure looks
 * like. The cost is real — a single bad poll now replaces the screen — and it
 * is the convention's cost, not this read's decision to make.
 */
export const listConductorRowPage = async (
  client: DropshClient,
  ctx: ConductorRowContext,
  query: ConductorQuery,
  page = 0,
): Promise<Page<ConductorRow>> => {
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = conductorParams(query);
  params.addPageLimit(window.limit);
  params.addPageOffset(window.offset);
  return loadPage(
    client,
    'bb_conductor/bb_conductor',
    params,
    (data, included) => {
      const machinesById = new Map<string, JsonApiResource>();
      for (const inc of included) if (inc.id) machinesById.set(inc.id, inc);
      return data.map((raw) => toConductorRow(raw, ctx, machinesById));
    },
    page,
    window,
  );
};

/**
 * A single conductor's own `last_seen`, or `undefined` when the record has
 * none or the read fails.
 *
 * BB-477 AC-5: the cockpit's `act('start', …)` polls this after a spawn,
 * comparing against the row's `lastSeen` captured before the start, to tell
 * a genuine new heartbeat apart from a stale one still in the window — the
 * same distinction the CLI's `waitForFreshHeartbeat` makes server-side.
 */
export const fetchConductorLastSeen = async (
  client: DropshClient,
  id: string,
): Promise<number | undefined> => {
  try {
    const doc = (await client.get(`bb_conductor/bb_conductor/${id}`)) as {
      data?: JsonApiResource;
    };
    const raw = doc?.data;
    if (!raw) return undefined;
    return toUnixSeconds(asResource(raw).attr('last_seen')) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * How large the collection under `query` is, or `null` when that is not
 * established (BB-460 D4).
 *
 * One row is requested because no row is wanted: the answer is `meta.count`, and
 * asking for a page of them to count them is the walk BB-292 removed. `null`
 * covers both a plane that reports no count (R1) and a failed probe — an
 * explanation is never a precondition, so its failure may not disturb the list
 * it was meant to explain.
 */
export const countConductors = async (
  client: DropshClient,
  query: ConductorQuery,
): Promise<number | null> => {
  const params = conductorParams(query);
  params.addPageLimit(1);
  try {
    const doc = (await client.get(
      'bb_conductor/bb_conductor',
      params,
    )) as JsonApiCollectionDoc;
    const count = doc?.meta?.count;
    return typeof count === 'number' && Number.isFinite(count) && count >= 0
      ? count
      : null;
  } catch {
    return null;
  }
};

/**
 * Project uuid → name, for the Conductors screen's project column and the
 * Projects tab (`loadProjectRows`).
 *
 * A conductor references its project by uuid; the screens show the name.
 *
 * Without `ids` this is one `bb_project` read, so only the first page of
 * visible projects is named. With `ids` only those projects are read, in
 * chunks below the server's page cap, so every referenced project is named
 * however many projects the user can see.
 *
 * A failed read yields an empty map: an unnamed project renders blank, which is
 * better than a screen that refuses to list conductors because their projects
 * could not be resolved.
 */
export const listProjectNames = async (
  client: DropshClient,
  ids?: string[],
): Promise<Map<string, string>> => {
  const nameOf = (r: Resource) =>
    str(r.attr('name')) ?? str(r.attr('label')) ?? '';
  if (!ids) {
    const outcome = await listOutcome(client, 'bb_project', (r) => ({
      id: r.id,
      name: nameOf(r),
    }));
    return new Map(outcome.rows.map((p) => [p.id, p.name]));
  }
  const names = new Map<string, string>();
  try {
    for (let i = 0; i < ids.length; i += LIST_PAGE_SIZE) {
      const chunk = ids.slice(i, i + LIST_PAGE_SIZE);
      const rows = await client
        .collection('bb_project')
        .whereIn('id', chunk)
        .list();
      for (const r of rows) names.set(r.id, nameOf(r));
    }
  } catch {
    return new Map();
  }
  return names;
};
