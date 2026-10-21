// The "New ticket" popup form (BB-190) as a DECLARATION over the form kernel
// (BB-236): seven fields plus two actions, and one `toObject` that yields the
// payload BOTH submit paths consume (BB-309). The mechanics — navigation, text
// editing, cycling, the multiselect cursor — all live in `Form/`; nothing of them
// is repeated here.
import {
  cycleValue,
  declareForm,
  type FieldDecl,
  type FieldFactory,
  type FieldKind,
  type FormState,
  type Option,
} from '../../../Form/index.js';
import { PARENT_PAGE_SIZE } from '../Data/parents.js';
import { PROJECT_PAGE_SIZE } from '../Data/projects-search.js';

export type { FieldKind, Option };
// `cycleValue` is re-exported because BB-233's contract cases pin it against
// an arbitrary option list, which no declared form can supply.
//
// `filterOptions` used to be re-exported beside it, so this popup's renderer
// could draw exactly the suggestion list the reducer clamps its cursor against
// without a second module reaching the kernel (boundary guard G3). The
// autocomplete WIDGET reaches the kernel directly now — G3 admits the widget
// layer, deliberately and for this very reason — so the re-export had no
// consumer left and is gone rather than left to rot into a stale comment.
export { cycleValue };

/**
 * Why an option bag is empty, per bag (BB-257 D4).
 *
 * The granularity is deliberate: the bags are independent reads, so collapsing
 * all of them on one failure is precisely the defect this ticket names. Every key
 * is optional — the errors ride along with the options they describe, so the
 * kernel needs no second piece of state and an existing options fixture stays
 * valid without mentioning them at all.
 */
export interface CreateOptionErrors {
  users?: string | undefined;
  reviewers?: string | undefined;
  conductors?: string | undefined;
  labels?: string | undefined;
  parents?: string | undefined;
  workflows?: string | undefined;
  templates?: string | undefined;
  /** BB-664 AC-8: the project picker's own search, shown only while the
   *  popup has no project in scope — see {@link CreateFormOptions.projects}. */
  projects?: string | undefined;
  /**
   * The whole load threw, rather than one bag failing. Until BB-257 the kernel
   * answered that by silently substituting four empty bags (F2a) — a whole-form
   * collapse that presented itself as "there is nothing to choose".
   */
  form?: string | undefined;
}

/**
 * A parent candidate as this popup offers it (BB-257 D5).
 *
 * A kernel `Option` — so the autocomplete field filters it by `label` and knows
 * nothing more — that ALSO carries the two fields the payload needs. Carrying
 * them is what lets `toObject` yield the parent's own identifier and title
 * instead of parsing the composed `bakers.build-nnn · title` label back apart, which
 * would make a separator character load-bearing across two modules.
 */
export interface ParentOption extends Option {
  identifier: string;
  title: string;
}

export interface CreateFormOptions {
  users: Option[];
  reviewers: Option[];
  conductors: Option[];
  labels: Option[];
  workflows: Option[];
  /**
   * The parent candidates, or ABSENT when there is no project in scope
   * (BB-257 D8). The distinction is the field's whole message: absent means
   * "no project context — nothing can be offered", while an empty ARRAY means
   * "this project was searched and nothing matched". An empty array cannot say
   * the first thing, which is why the key is optional rather than defaulted.
   */
  parents?: ParentOption[] | undefined;
  /**
   * Candidate projects, searched by name — the SAME source the project-filter
   * picker composes (`projectOptionSource`). Only declared as a source while
   * the popup has no project in scope (BB-664 AC-8): with one, the operator
   * is already working inside it and the field does not exist.
   */
  projects?: Option[] | undefined;
  /**
   * The project's ticket templates, or ABSENT when no project is in
   * scope. Picking one turns both submit rows into "run this template".
   */
  templates?: Option[] | undefined;
  /** Present only when at least one read failed; see `CreateOptionErrors`. */
  errors?: CreateOptionErrors | undefined;
}

// The workflow classification is the `bb_ticket` `workflow` field's own fixed
// vocabulary, so it lives in the slice's Data/ beside the other ticket properties —
// and is DERIVED there from one declaration shared with the ticket filter, which
// previously kept its own second copy (BB-236 phase 4). Re-exported so this form's
// existing import sites are unchanged.
export { WORKFLOW_OPTIONS } from '../Data/workflow.js';

/** A declared field with a narrowed `id` — what both popups' field lists are. */
export type FieldDef<Id extends string = string> = Omit<FieldDecl, 'id'> & {
  id: Id;
};

/**
 * The two action rows' field ids (BB-309 D3/D7).
 *
 * Exported because the SCREEN branches on them: the kernel's one `submit`
 * intent cannot say which of two actions was fired, so the screen resolves the
 * active field and compares. `'submit'` keeps its name for the agent row so
 * every pre-BB-309 assertion about it stays literally true.
 */
export const AGENT_ACTION_ID = 'submit';
export const DIRECT_ACTION_ID = 'direct';

export type CreateFieldId =
  | 'project'
  | 'title'
  | 'description'
  | 'parent'
  | 'assignee'
  | 'reviewers'
  | 'conductor'
  | 'labels'
  | 'workflow'
  | 'template'
  | 'submit'
  | 'direct';

/** What the form HOLDS. `active`/`cursor` are the kernel's and must not appear. */
export interface CreateValues {
  /**
   * The PICKED project's uuid, or null — BB-664 AC-8. Only a field on the
   * form built WITHOUT a project in scope ({@link CREATE_FORM_WITH_PROJECT});
   * on the ordinary form (a project already in scope) nothing ever sets it, so
   * it reads as `undefined` at runtime despite the type — the same shape the
   * other two-key autocomplete, `parent`, already has when its source is
   * absent. `projectQuery` holds what was typed.
   */
  project: string | null;
  projectQuery: string;
  /**
   * The ticket's title. `bb_ticket.title` is `setRequired(TRUE)` server-side,
   * so a direct create without one is rejected — this was never optional
   * (BB-309 D1). Deriving it from the description's first line was considered
   * and rejected: the operator could not correct a bad title without rewriting
   * their own opening sentence.
   */
  title: string;
  description: string;
  /** The PICKED parent's uuid, or null. `parentQuery` holds what was typed —
   *  an autocomplete field owns two keys (BB-257 D5). */
  parent: string | null;
  parentQuery: string;
  assignee: string | null;
  reviewers: ReadonlySet<string>;
  conductor: string | null;
  labels: ReadonlySet<string>;
  workflow: string | null;
  /** The picked ticket template's uuid, or null. Never remembered. */
  template: string | null;
}

/** The parent as the create agent receives it (BB-257 D9). */
export interface ParentRef {
  id: string;
  identifier: string;
  title: string;
}

/** The submitted payload (resolved options), handed to the create agent. */
export interface CreateFormPayload {
  /** What the operator NAMED the ticket. Required server-side (BB-309 D1). */
  title: string;
  description: string;
  workflow: Option | null;
  assignee: Option | null;
  reviewers: Option[];
  conductor: Option | null;
  labels: Option[];
  /**
   * The ticket the new one goes under, or null when none was picked (AC-7).
   * A non-null value becomes the created ticket's `parent_id`, from which the
   * server derives `base_branch` — no client-side branch logic (spec F4).
   */
  parent: ParentRef | null;
}

/** The option with `id`, or null — used by both forms' `toObject`. */
export const optionFor = (list: Option[], id: string | null): Option | null =>
  list.find((o) => o.id === id) ?? null;

/**
 * The picked candidate as a payload reference, or null.
 *
 * A pick that is no longer in the bag yields null rather than a phantom id:
 * the bag is replaced on every debounced re-query (D7), so a pick can outlive
 * the row it came from, and a `parent_id` the payload cannot even describe is
 * worse than no parent at all.
 */
const parentFor = (
  list: ParentOption[],
  id: string | null,
): ParentRef | null => {
  const hit = list.find((p) => p.id === id);
  return hit
    ? { id: hit.id, identifier: hit.identifier, title: hit.title }
    : null;
};

/**
 * The shared field list (BB-664 AC-8): every field BUT the project picker,
 * which only one of the two declarations below carries. Factored out so the
 * two forms cannot drift apart on the fields neither decision touches — only
 * `declareForm`'s one `fields` callback may differ between them.
 */
const sharedFields = (
  f: FieldFactory<CreateValues, CreateFormOptions>,
): FieldDecl[] => [
  // First, because it is the one field the server REQUIRES (D1). Both submit
  // paths read it: the direct write sends it, the agent adopts it from the
  // temp JSON spec.
  f.text('title', 'Title'),
  f.text('description', 'Description'),
  // Between the description and the assignee on purpose: a parent is chosen
  // WITH what the ticket is about, before who works on it (BB-257 D5).
  f.autocomplete('parent', 'Parent', {
    from: 'parents',
    query: 'parentQuery',
    // The two things an ENTITY-AGNOSTIC widget cannot know, as plain data on
    // the declaration (BB-257 re-entry AC-15 keeps a field printable, so
    // neither may be a function). `absentNote` is what an ABSENT bag means
    // HERE — the popup opened from the dashboard, where `n` is global and no
    // project is in scope (D8) — as against an empty array, which would mean
    // "this project was searched and nothing matched". `pageSize` is what the
    // bag is filled from, so the suggestion list can say a full page may be a
    // truncated answer even when the local filter narrows it (R3 / AC-17).
    absentNote: '(no project context — open a project to pick a parent)',
    pageSize: PARENT_PAGE_SIZE,
  }),
  f.select('assignee', 'Assignee', { from: 'users' }),
  f.multi('reviewers', 'Reviewers', { from: 'reviewers' }),
  // Clearable (D2): a SET conductor means the ticket is claimed at the next
  // poll and a qualification run starts; a cleared one means it waits for a
  // human. The field is clearable precisely so that choice is the operator's
  // and not implicit. The preselection survives — `initial()` fills a select
  // from `listOf(options)[0]` regardless of `clearable`, and `ownFirst` in
  // `create-data.ts` puts the machine's own conductor there.
  f.select('conductor', 'Conductor', { from: 'conductors', clearable: true }),
  f.multi('labels', 'Labels', { from: 'labels' }),
  f.select('workflow', 'Workflow', { from: 'workflows' }),
  // A template replaces the ordinary create, so it sits right above
  // the action rows. Clearable, and opened EMPTY by the screen (`initial` would
  // preselect the first option of a select).
  f.select('template', 'Template', { from: 'templates', clearable: true }),
  // Agent row FIRST and keeping the id `'submit'` (D7): nothing that exists
  // today changes its meaning or its position.
  f.action('Create with agent', AGENT_ACTION_ID),
  f.action('Create directly', DIRECT_ACTION_ID),
];

const toCreatePayload = (
  v: CreateValues,
  o: CreateFormOptions,
): CreateFormPayload => ({
  title: v.title,
  description: v.description,
  workflow: optionFor(o.workflows, v.workflow),
  assignee: optionFor(o.users, v.assignee),
  reviewers: (o.reviewers ?? []).filter((x) => v.reviewers.has(x.id)),
  conductor: optionFor(o.conductors, v.conductor),
  labels: o.labels.filter((x) => v.labels.has(x.id)),
  parent: parentFor(o.parents ?? [], v.parent),
});

/**
 * The declaration used whenever a project is already in scope (unchanged,
 * BB-664 AC-8). No field carries a function. Exactly ONE select is
 * `clearable` — the conductor (BB-309 D2); every other one cycles over real
 * options only, exactly as before BB-233.
 */
export const CREATE_FORM = declareForm<
  CreateValues,
  CreateFormOptions,
  CreateFormPayload
>({
  fields: sharedFields,
  toObject: toCreatePayload,
});

/**
 * The declaration used when the popup opens with NO project in scope
 * (BB-664 AC-8, the human decision replacing the old refusal-only form):
 * one extra `autocomplete` field, ahead of everything else, over the SAME
 * `projectOptionSource` the project-filter picker searches with — never a
 * second project read. Picking a row here is what the screen reads to scope
 * the Conductor bag and to carry a project into both submit paths; `toObject`
 * needs none of it; the id travels through `CreateValues.project` instead,
 * the same way the screen already reads `context.project` for the other form.
 */
export const CREATE_FORM_WITH_PROJECT = declareForm<
  CreateValues,
  CreateFormOptions,
  CreateFormPayload
>({
  fields: (f) => [
    f.autocomplete('project', 'Project', {
      from: 'projects',
      query: 'projectQuery',
      pageSize: PROJECT_PAGE_SIZE,
    }),
    ...sharedFields(f),
  ],
  toObject: toCreatePayload,
});

/** Field order in the popup (top to bottom), a project already in scope. */
export const FIELDS =
  CREATE_FORM.fields as unknown as FieldDef<CreateFieldId>[];

/** Field order with NO project in scope (BB-664 AC-8) — `FIELDS` plus the
 *  Project picker, ahead of everything else. */
export const FIELDS_WITH_PROJECT =
  CREATE_FORM_WITH_PROJECT.fields as unknown as FieldDef<CreateFieldId>[];

export type CreateFormState = FormState<CreateValues>;

/**
 * The values the popup carries from one open to the next (BB-314 D2).
 *
 * The popup is ONE screen instance, entered again and again (spec F1/F2), so
 * something has to say which of its values are the ticket being written and
 * which are the operator's standing routing choice. That answer belongs beside
 * the field declaration, not in the screen: the `Pick` ties the list to the
 * value shape, so renaming a field breaks the build instead of silently
 * dropping it out of the memory.
 *
 * `workflow` is NOT here, deliberately. A ticket type is a per-ticket decision,
 * and a silently retained `bb_bug` on the next feature ticket is a wrong
 * value nobody looks at (D5). The parent contributes BOTH of its keys, because
 * an autocomplete owns two and `apply` never produces one without the other
 * (D4).
 */
export type CreateRemembered = Pick<
  CreateValues,
  'parent' | 'parentQuery' | 'assignee' | 'conductor' | 'labels'
>;

/** Snapshot the routing values of a form that is about to be replaced. */
export const rememberedValues = (s: CreateFormState): CreateRemembered => ({
  parent: s.parent,
  parentQuery: s.parentQuery,
  assignee: s.assignee,
  conductor: s.conductor,
  // Copied, not referenced: the snapshot outlives the state object it came
  // from, and the reducer builds a NEW Set on every toggle — an alias would
  // make the memory depend on which of the two was mutated last.
  labels: new Set(s.labels),
});

// ---- thin adapters (BB-236 AC-3) -----------------------------------------
//
// The popup itself is driven by `keyToIntent` + `CREATE_FORM.apply` in the kernel.
// These per-transition functions stay because they ARE this module's tested
// contract: keeping them is what lets `tests/Service/create-form.test.ts` prove the
// re-cut changed no behaviour instead of being rewritten to match it.

export const initialForm = (
  opts: CreateFormOptions,
  prefill: Partial<CreateValues> = {},
): CreateFormState => CREATE_FORM.initial(opts, prefill);

export const activeField = (s: CreateFormState): FieldDef<CreateFieldId> =>
  CREATE_FORM.activeField(s) as FieldDef<CreateFieldId>;

export const moveField = (s: CreateFormState, delta: number): CreateFormState =>
  CREATE_FORM.move(s, delta);

/** Append typed text to the description (only meaningful on the text field). */
export const typeChar = (s: CreateFormState, text: string): CreateFormState =>
  CREATE_FORM.apply(s, NO_OPTIONS, { kind: 'insert', text });

export const backspace = (s: CreateFormState): CreateFormState =>
  CREATE_FORM.apply(s, NO_OPTIONS, { kind: 'backspace' });

export const newline = (s: CreateFormState): CreateFormState =>
  CREATE_FORM.apply(s, NO_OPTIONS, { kind: 'newline' });

/** Cycle the active single-select field's value by `dir` (+1 / -1). */
export const cycle = (
  s: CreateFormState,
  opts: CreateFormOptions,
  dir: 1 | -1,
): CreateFormState => CREATE_FORM.apply(s, opts, { kind: 'cycle', dir });

export const moveLabelCursor = (
  s: CreateFormState,
  opts: CreateFormOptions,
  dir: 1 | -1,
): CreateFormState => CREATE_FORM.apply(s, opts, { kind: 'cursor', dir });

export const toggleLabel = (
  s: CreateFormState,
  opts: CreateFormOptions,
): CreateFormState => CREATE_FORM.apply(s, opts, { kind: 'toggle' });

export const serialize = (
  s: CreateFormState,
  opts: CreateFormOptions,
): CreateFormPayload => CREATE_FORM.toObject(s, opts);

// The text intents never read an option list, so the three text adapters — whose
// signatures predate the kernel and take no options — pass an empty bag.
const NO_OPTIONS: CreateFormOptions = {
  users: [],
  reviewers: [],
  conductors: [],
  labels: [],
  workflows: [],
};

// ---- field-list helpers, still asserted by BB-233's AC-9 cases ------------
//
// The kernel owns navigation now, but `tests/Service/create-form.test.ts` pins
// these against an ARBITRARY field list, which no declared form can supply.

/** The field at `active`, or the first one when the index is out of range. */
export const fieldAt = <F extends FieldDef>(fields: F[], active: number): F =>
  (fields[active] ?? fields[0]) as F;

/** The next active index, clamped against the PASSED field list. */
export const nextActive = (
  fields: readonly unknown[],
  active: number,
  delta: number,
): number => Math.max(0, Math.min(active + delta, fields.length - 1));
