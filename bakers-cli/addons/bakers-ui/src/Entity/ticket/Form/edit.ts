// The "Edit ticket" popup (BB-233, widened by BB-308 / BB-313 / BB-360)
// as a DECLARATION over the form kernel (BB-236): two `clearable` selects, two
// text fields for accounted durations, a clearable Parent autocomplete, a Labels
// multi-select, and dual actions (Save + Cancel ticket on non-terminal). One
// `toObject` yields the ordinary Save PATCH; Cancel ticket uses a separate pure
// payload helper. No I/O here.
//
// BB-360 removes the State select entirely (D8). Cancelling is a second
// `f.action` whose id is never `cancel` — that intent closes the popup (Esc).
// Two declarations from one body: a terminal ticket's popup simply omits the
// Cancel ticket action (D3), and `editFormFor` picks between them.
import { declareForm, type FormState } from '../../../Form/index.js';
import { formatDuration, parseDuration } from '../../../lib/format.js';
import type { TicketDetailDocument } from '../../../types.js';
import { PARENT_PAGE_SIZE } from '../Data/parents.js';
import type { FieldDef, Option } from './create.js';

export type EditFieldId =
  | 'assignee'
  | 'reviewers'
  | 'conductor'
  | 'estimate'
  | 'spent'
  | 'parent'
  | 'ticketType'
  | 'recipe'
  | 'labels'
  | 'submit'
  | 'cancelTicket';

/**
 * BB-313 / BB-360 — the ONE lifecycle move this popup offers, as a named
 * constant.
 *
 * Not derived, and deliberately so: `state_flow` is a `bb_dashboard` computed
 * field rendering the happy path (`qualification … done`) and never contains
 * `cancelled`, so no served fact carries the cancel edge. The precedent is
 * `STATE_FILTER_VALUES` in `Data/query.ts`, hardcoded for the same reason.
 *
 * One constant serves every ticket workflow because in the ticket workflow
 * (`bb_work`) `cancel.from` is exactly the set of non-terminal states — so
 * "non-terminal" and "the workflow permits cancelling" are the same
 * predicate, and no workflow id is needed to tell them apart.
 */
export const CANCELLED_STATE = 'cancelled';

/**
 * The Cancel ticket action's field id (BB-360 D4).
 *
 * Never `'cancel'` — `intent.kind === 'cancel'` already means "close the
 * popup", and two meanings for one word is a defect waiting.
 */
export const CANCEL_TICKET_ACTION_ID = 'cancelTicket';

/**
 * The states no transition leaves, in every ticket workflow.
 *
 * The server's own definition (`TypeWorkflows::isTerminal` — "a state no
 * transition leaves") evaluates to exactly this pair for `bb_work`.
 */
export const TERMINAL_TICKET_STATES: ReadonlySet<string> = new Set([
  'done',
  CANCELLED_STATE,
]);

/** The option lists the popup offers (loaded by `loadEditFormOptions`). */
export interface EditFormOptions {
  users: Option[];
  reviewers: Option[];
  conductors: Option[];
  /** The `type` vocabulary, for the single-valued `ticket_type` (BAKERS-17). */
  ticketTypes: Option[];
  /** The `recipe` vocabulary, for the single-valued `recipe` (BAKERS-17). */
  recipes: Option[];
  labels: Option[];
  errors?: { reviewers?: string | undefined } | undefined;
  /**
   * Parent candidates from the option loader (project-scoped typeahead). Absent
   * until the screen primes a source; an empty array means "searched, nothing
   * matched" once a source is live.
   */
  parents?: Option[] | undefined;
}

/** What the form HOLDS. `ticketId` is a NON-field value: the kernel carries it
 *  verbatim so submit needs no ambient state, and never transitions it. */
interface EditValues {
  ticketId: string;
  /** Whether `relationships.reviewers` was present on the loaded document. */
  reviewersLoaded: boolean;
  assignee: string | null;
  reviewers: ReadonlySet<string>;
  conductor: string | null;
  /** The human duration as TYPED — seconds only exist at `toObject` (D5). */
  estimate: string;
  spent: string;
  /** The PICKED parent's uuid, or null. `parentQuery` holds what was typed. */
  parent: string | null;
  parentQuery: string;
  ticketType: string | null;
  recipe: string | null;
  labels: ReadonlySet<string>;
}

/** A JSON:API to-one linkage, or an explicit `null` for "remove it". */
const linkage = (
  type: string,
  id: string | null,
): { data: { type: string; id: string } | null } => ({
  data: id === null ? null : { type, id },
});

/** Multi-value term linkage for labels (always present on ordinary Save). */
const labelsLinkage = (
  ids: ReadonlySet<string>,
): { data: { type: string; id: string }[] } => ({
  data: [...ids].map((id) => ({ type: 'bb_term--label', id })),
});

/** The payload of the ordinary Save PATCH (BB-233 Decision 2). */
export interface EditFormPayload {
  attributes: Record<string, number | string | null>;
  relationships: {
    assignee_user_id: { data: { type: string; id: string } | null };
    conductor_id: { data: { type: string; id: string } | null };
    ticket_type: { data: { type: string; id: string } | null };
    recipe: { data: { type: string; id: string } | null };
    labels: { data: { type: string; id: string }[] };
    parent_id: { data: { type: string; id: string } | null };
    reviewers?: { data: { type: string; id: string }[] };
  };
}

/** Cancel ticket writes ONLY the lifecycle attribute (BB-360 D1). */
export interface CancelEditPayload {
  attributes: { state: typeof CANCELLED_STATE };
}

/**
 * The two time attributes of the PATCH, in seconds.
 *
 * Three outcomes per field, and the third is the reason this is not a one-liner:
 *   parsed value → the number;
 *   empty input  → `null`, an explicit REMOVE (the selects are clearable for the
 *                  same reason — AC-4 requires removing a value, not only
 *                  changing it);
 *   unparseable  → the key is OMITTED. Writing 0 for "soon" would silently
 *                  destroy a real estimate, and the popup has no validation
 *                  channel of its own; leaving the key out means the server
 *                  keeps what it had and the operator sees their typo survive
 *                  the save.
 *
 * This is why `toObject` cannot emit both keys unconditionally the way the
 * relationships do.
 */
const timeAttributes = (v: EditValues): Record<string, number | null> => {
  const out: Record<string, number | null> = {};
  for (const [key, field] of [
    ['time_estimate', 'estimate'],
    ['time_spent', 'spent'],
  ] as const) {
    const raw = v[field];
    const seconds = parseDuration(raw);
    if (seconds === null) continue;
    out[key] = raw.trim() === '' ? null : seconds;
  }
  return out;
};

/**
 * One body, two declarations (D3 / D8).
 *
 * BOTH assignment selects are `clearable`: AC-4 requires REMOVING an assignment,
 * not only changing it, so `null` is a real position in each cycle. Parent is
 * clearable for the same reason (D7), and so are Type and Recipe. Labels
 * always PATCH the full selected set,
 * including empty.
 *
 * Ordinary Save NEVER includes `attributes.state` — a self-transition is not a
 * declared edge, so echoing the current state would turn every ordinary edit
 * into a 422. Cancel ticket is a separate action that uses `cancelEditPayload`.
 *
 * The kernel builds its field list once, at module load, and every consumer —
 * the renderer's `▸` marker, `keyToIntent`, `apply` — indexes that array by
 * `state.active`. So a row cannot be hidden at render time without shifting
 * every index below it; absence has to be a property of WHICH DECLARATION is in
 * force.
 */
const declareEditForm = (savable: boolean, cancellable: boolean) =>
  declareForm<EditValues, EditFormOptions, EditFormPayload>({
    fields: (f) => [
      f.select('assignee', 'Assignee', { from: 'users', clearable: true }),
      f.multi('reviewers', 'Reviewers', { from: 'reviewers' }),
      f.select('conductor', 'Conductor', {
        from: 'conductors',
        clearable: true,
      }),
      f.text('estimate', 'Estimate'),
      f.text('spent', 'Spent'),
      f.autocomplete('parent', 'Parent', {
        from: 'parents',
        query: 'parentQuery',
        clearable: true,
        absentNote: '(no project context — open a project to pick a parent)',
        pageSize: PARENT_PAGE_SIZE,
      }),
      f.select('ticketType', 'Type', { from: 'ticketTypes', clearable: true }),
      f.select('recipe', 'Recipe', { from: 'recipes', clearable: true }),
      f.multi('labels', 'Labels', { from: 'labels' }),
      ...(savable ? [f.action('Save', 'submit')] : []),
      ...(cancellable
        ? [f.action('Cancel ticket', CANCEL_TICKET_ACTION_ID)]
        : []),
    ],
    toObject: (v) => ({
      // Ordinary Save never writes lifecycle state (D6/D7).
      attributes: { ...timeAttributes(v) },
      relationships: {
        assignee_user_id: linkage('user--user', v.assignee),
        conductor_id: linkage('bb_conductor--bb_conductor', v.conductor),
        ticket_type: linkage('bb_term--type', v.ticketType),
        recipe: linkage('bb_term--recipe', v.recipe),
        labels: labelsLinkage(v.labels),
        parent_id: linkage('bb_ticket--bb_ticket', v.parent),
        ...(v.reviewersLoaded || v.reviewers.size > 0
          ? {
              reviewers: {
                data: [...v.reviewers].map((id) => ({
                  type: 'user--user',
                  id,
                })),
              },
            }
          : {}),
      },
    }),
  });

/** The ordinary popup: a non-terminal ticket can be cancelled from it. */
export const EDIT_FORM = declareEditForm(true, true);
/** A terminal ticket's popup: assignment, times, structure — no Cancel ticket. */
export const EDIT_FORM_TERMINAL = declareEditForm(true, false);
/**
 * A closed ticket's popup: read-only, no Save and no Cancel ticket. The server
 * freezes a ticket on its stored `closed` flag and answers any PATCH with 403.
 */
export const EDIT_FORM_CLOSED = declareEditForm(false, false);
export type EditFormDeclaration = typeof EDIT_FORM;

/** The ticket's state as the popup sees it; `''` when the read carried none. */
export const ticketState = (document: TicketDetailDocument): string => {
  const value = document.data?.attributes?.state;
  return typeof value === 'string' ? value : '';
};

/**
 * Which declaration a ticket gets (AC-4 / D13).
 *
 * An unknown state fails OPEN (D13): `loadTicketDetail` requests no fieldset, so
 * a missing `state` means genuinely unknown rather than not-requested. Hiding
 * Cancel ticket on a thin read would cost a legitimate affordance; offering it
 * costs at worst the server's 422, which the popup already renders in full.
 */
export const editFormFor = (
  document: TicketDetailDocument,
): EditFormDeclaration => {
  if (document.data?.attributes?.closed === true) return EDIT_FORM_CLOSED;
  return TERMINAL_TICKET_STATES.has(ticketState(document))
    ? EDIT_FORM_TERMINAL
    : EDIT_FORM;
};

/** Field order in the popup, per declaration. */
export const EDIT_FIELDS =
  EDIT_FORM.fields as unknown as FieldDef<EditFieldId>[];
export const EDIT_FIELDS_TERMINAL =
  EDIT_FORM_TERMINAL.fields as unknown as FieldDef<EditFieldId>[];
export const EDIT_FIELDS_CLOSED =
  EDIT_FORM_CLOSED.fields as unknown as FieldDef<EditFieldId>[];

export type EditFormState = FormState<EditValues>;

/**
 * No lists to OFFER — bags start empty until the adapter / option loader fills
 * them. Prefill names every value, and `clear`/`toObject` read no option list
 * for the required fields, so adapters that have no options hand over this bag.
 * Exported so the screen's options-failure path can reuse it (D11): a failed
 * user/conductor/label read must not silently remove Cancel ticket (D8 keeps
 * the action on the declaration, not in the bag).
 */
export const EMPTY_EDIT_FORM_OPTIONS: EditFormOptions = {
  users: [],
  reviewers: [],
  conductors: [],
  ticketTypes: [],
  recipes: [],
  labels: [],
};

const relId = (document: TicketDetailDocument, name: string): string | null => {
  const data = document.data?.relationships?.[name]?.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0]?.id ?? null) : data.id;
};

const labelIds = (document: TicketDetailDocument): ReadonlySet<string> => {
  const data = document.data?.relationships?.labels?.data;
  if (!data) return new Set();
  if (Array.isArray(data)) {
    return new Set(data.map((row) => row.id).filter(Boolean));
  }
  return data.id ? new Set([data.id]) : new Set();
};

const reviewersFromDocument = (
  document: TicketDetailDocument,
): { ids: ReadonlySet<string>; loaded: boolean } => {
  const rel = document.data?.relationships?.reviewers;
  if (rel === undefined) return { ids: new Set(), loaded: false };
  const data = rel.data;
  // A to-many relationship without `data` was not read; never treat it as empty.
  if (!data) return { ids: new Set(), loaded: false };
  if (Array.isArray(data)) {
    return {
      ids: new Set(data.map((row) => row.id).filter(Boolean)),
      loaded: true,
    };
  }
  return { ids: data.id ? new Set([data.id]) : new Set(), loaded: true };
};

const timeValue = (document: TicketDetailDocument, name: string): string => {
  const value = document.data?.attributes?.[name];
  // An unset field prefills EMPTY, never `0m`: the popup must not turn "nobody
  // estimated this" into a typed zero the operator then saves by accident.
  return typeof value === 'number' ? formatDuration(value) : '';
};

/**
 * Parent query text from the detail include when present (D9).
 *
 * A known parent must not blank when absent from the first candidate page — the
 * id is always set from the relationship; the query is best-effort display
 * material from the sideload. Missing include ⇒ empty query, id still set.
 */
const parentQueryFromDocument = (
  document: TicketDetailDocument,
  parentId: string | null,
): string => {
  if (!parentId) return '';
  const hit = document.included?.find(
    (row) => row.id === parentId && row.type === 'bb_ticket--bb_ticket',
  );
  if (!hit) return '';
  const attrs = hit.attributes ?? {};
  const identifier =
    typeof attrs.identifier === 'string' ? attrs.identifier : '';
  const title = typeof attrs.title === 'string' ? attrs.title : '';
  if (!identifier && !title) return '';
  return [identifier, title].filter(Boolean).join(' · ');
};

/** Prefill from the ticket's CURRENT values (AC-1) — never from `opts[0]`. The
 *  kernel applies a prefill with `Object.hasOwn`, so an unassigned ticket's
 *  explicit `null` STICKS instead of falling back to the first option. */
export function initialEditForm(document: TicketDetailDocument): EditFormState {
  const parent = relId(document, 'parent_id');
  const reviewers = reviewersFromDocument(document);
  return EDIT_FORM.initial(EMPTY_EDIT_FORM_OPTIONS, {
    ticketId: document.data?.id ?? '',
    reviewersLoaded: reviewers.loaded,
    assignee: relId(document, 'assignee_user_id'),
    reviewers: reviewers.ids,
    conductor: relId(document, 'conductor_id'),
    estimate: timeValue(document, 'time_estimate'),
    spent: timeValue(document, 'time_spent'),
    parent,
    parentQuery: parentQueryFromDocument(document, parent),
    ticketType: relId(document, 'ticket_type'),
    recipe: relId(document, 'recipe'),
    labels: labelIds(document),
  });
}

/**
 * The Cancel ticket PATCH body (BB-360 D1): lifecycle only.
 *
 * Local field edits are discarded; after a successful write the detail reloads
 * from the server (same as Save's reload path). No relationships.
 */
export const cancelEditPayload = (): CancelEditPayload => ({
  attributes: { state: CANCELLED_STATE },
});

// ---- thin adapters over the kernel (the popup itself runs on keyToIntent) ----

export const activeEditField = (s: EditFormState): FieldDef<EditFieldId> =>
  EDIT_FORM.activeField(s) as FieldDef<EditFieldId>;

export const moveEditField = (s: EditFormState, delta: number): EditFormState =>
  EDIT_FORM.move(s, delta);

/** Cycle the active select by `dir`, `null` included (AC-4). */
export const cycleEdit = (
  s: EditFormState,
  opts: EditFormOptions,
  dir: 1 | -1,
): EditFormState => EDIT_FORM.apply(s, opts, { kind: 'cycle', dir });

/** Clear the active select/autocomplete outright (the Del/Backspace shortcut). */
export const clearEditValue = (s: EditFormState): EditFormState =>
  EDIT_FORM.apply(s, EMPTY_EDIT_FORM_OPTIONS, { kind: 'clear' });

export const serializeEdit = (s: EditFormState): EditFormPayload =>
  EDIT_FORM.toObject(s, EMPTY_EDIT_FORM_OPTIONS);
