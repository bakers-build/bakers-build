/**
 * BB-204 — workflow step contract (pure library).
 *
 * "Everything is a skill; `WORKFLOW.md` is a pure loader." Each step-owning skill
 * self-declares one `when:` over three variables — `work_type`, `workflow`, `step` —
 * and owns that step's whole flow in prose. Each skill declares its `inputs` (a short
 * description + a default per value); a project overrides a value inline under the
 * skill's bullet in `WORKFLOW.md`'s `## Loaded skills` list. Effective value =
 * override ?? default.
 *
 * A **bundle** skill carries a `## Loaded skills` section in its own body and thereby
 * loads further skills — the same section, the same bullet syntax, the same parser as
 * `WORKFLOW.md`. Nothing in the frontmatter marks it; the section is the marker.
 *
 * This module is the mechanical enforcement of that model. It PARSES, EXPANDS along
 * a fixed value precedence, and VALIDATES — it never dispatches or routes.
 * Its only consumers are the contract test suite and `@bakers-build/upgrade-project` /
 * `@bakers-build/init-project` load-time validation.
 */
import { parse as parseYaml } from 'yaml';

/** The workflow states an agent works — the legal `step` values. */
export const WORKFLOW_STEPS = [
  'qualification',
  'plan',
  'working',
  // shortcut: spec/diagnose/coding stay until the skills move to plan/working, then remove them.
  'spec',
  'diagnose',
  'coding',
  'review',
  'pre_deployment',
  'post_deployment',
  'verifying',
  'summary',
] as const;

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

/**
 * The machine-readable classification of a contract defect, for consumers that
 * must branch on *which* defect it is rather than on what it says.
 *
 * BB-436: `bakers validate` used to recover this from a regex over the message
 * text (`/^loaded skill \`([^\`]+)\` not found\.$/`). That leaked twice — the
 * sibling defect raised by the same `walk()` (`bundle \`x\` loads unknown skill
 * \`y\`.`) is the same class of problem and matched nothing, so it got no remedy
 * printed; and rewording any message would have broken the consumer across the
 * package boundary without a single failing test to say so.
 *
 * Deliberately narrow: exactly the two codes a caller branches on **today**. Most
 * throw sites in this module carry no code, and that is correct — a code is added
 * when a consumer needs to distinguish that defect, never speculatively, because
 * an unused code is a contract nobody validates.
 */
export type StepContractErrorCode = 'unresolved_skill' | 'empty_loader';

/**
 * Typed defect raised on the first contract violation.
 *
 * The single-argument form `new StepContractError(message)` is the norm and stays
 * the norm; `details` is opt-in for the few defects a consumer classifies.
 */
export class StepContractError extends Error {
  /** The defect's classification, when it is one a consumer branches on. */
  readonly code?: StepContractErrorCode;
  /**
   * For `unresolved_skill`: the skill name that could not be resolved — the root
   * bullet's, or the bundle member's. Named `skill` rather than `name` because
   * `Error.name` is already taken (and set to `StepContractError` below).
   */
  readonly skill?: string;

  constructor(
    message: string,
    details?: { code: StepContractErrorCode; skill?: string },
  ) {
    super(message);
    this.name = 'StepContractError';
    // `exactOptionalPropertyTypes` is on: assign an optional property only when
    // the value is actually defined, never `undefined`.
    if (details !== undefined) this.code = details.code;
    if (details?.skill !== undefined) this.skill = details.skill;
  }
}

/**
 * A normalized `when` clause value: a concrete list of allowed values, the
 * wildcard `'*'` (matches anything), or `undefined` (key omitted — also any).
 */
export type WhenValue = string[] | '*' | undefined;

/** A skill's `when` triple. Any of the three keys may be omitted (= any). */
export interface SkillWhen {
  work_type: WhenValue;
  workflow: WhenValue;
  step: WhenValue;
}

/** One declared input: a value key with a short description and an optional default. */
export interface InputDecl {
  /** The value key the skill reads (e.g. `test.command`). */
  key: string;
  /** A short human description of what the value is. */
  description?: string;
  /** The default used when `WORKFLOW.md` supplies no override for this key. */
  default?: string;
}

/** The parsed contract of a single skill's frontmatter. */
export interface SkillContract {
  /** Skill name from frontmatter. */
  name: string;
  /**
   * The `when` triple, or `undefined` when the skill declares no `when` — a
   * helper/capability skill that owns no step and routes nothing.
   */
  when?: SkillWhen;
  /** The inputs the skill declares (each: key + description + optional default). */
  inputs: InputDecl[];
  /**
   * A **bundle** skill carries its own `## Loaded skills` section in its markdown
   * **body** — the same list a `WORKFLOW.md` carries. `loads` holds those member
   * names in declared order. Nothing in the frontmatter marks a bundle; the
   * section is the marker. Present only on bundles.
   */
  loads?: string[];
  /**
   * A bundle's member values: the inline `key: value` overrides written under a
   * member's bullet in the bundle body, keyed by member skill name. Present only
   * on bundles.
   */
  values?: StepValues;
}

/**
 * A concrete `(work_type, workflow, step)` the project can produce. `work_type`
 * is `null` for a non-work-typed step (qualification, plan, deployment,
 * verification), a `work:*` label (without the prefix) otherwise.
 */
export interface Triple {
  work_type: string | null;
  workflow: string;
  step: WorkflowStep;
}

/** Per-skill values, keyed by skill `name` (the namespace prefix stripped). */
export type StepValues = Record<string, Record<string, string>>;

const LOADED_SKILLS_HEADING = /^##\s+Loaded skills\s*$/;
/**
 * One loaded-skill bullet: `- @<namespace>/<skill-name>`, **at indent 0**.
 *
 * BB-436: the namespace is captured only to be discarded. A skill is addressed
 * by NAME — the prefix says which plugin ships it, and a project may load a step
 * owner from any plugin (`@designbook-bakers/debo-config-sync`), not just `@bakers-build/`.
 * Hardcoding `@bakers-build/` here made every foreign bullet unmatched, and an unmatched
 * bullet at indent 0 fell through to the "dedented prose" branch below — dropping
 * its own overrides *and* flushing away the preceding bullet's, in silence.
 *
 * The indent-0 anchor is the second half of the same defect. A load site is a
 * top-level list item — in `WORKFLOW.md` and in a bundle body alike — while an
 * indented `- @…` line is *value*: `.prompt` block scalars are written as lists
 * of required skills. Matching at any indent read such a line as an address,
 * which truncated the block scalar mid-value and invented a phantom skill from
 * the line, and `validateLoad` then reported that corrupted load as clean.
 */
const BULLET = /^-\s+@([a-z0-9-]+)\/([a-z0-9-]+)\s*$/;
/**
 * A line merely *shaped* like a bullet — a top-level list item whose content
 * starts `@`. Inside `## Loaded skills` such a line is an address, never prose,
 * so one that `BULLET` cannot parse is REPORTED (BB-436) instead of taking the
 * prose branch. That report is what stops a malformed address from damaging its
 * neighbour. It carries `BULLET`'s indent-0 anchor for the same reason: without
 * it, a near-miss inside a block scalar — `- @bakers-build/read-ticket before anything
 * else.` — failed a document that was correct, and the remedy the message
 * prescribes steered the author onto the exact form, which is the silent case.
 */
const BULLET_SHAPED = /^-\s+@/;

/**
 * Locate the `## Loaded skills` section in a markdown document: the `[start, end)`
 * line range of its body, or `null` when the document carries no such section.
 *
 * The section is the **only** marker of a loader — `WORKFLOW.md` carries one, and so
 * does a **bundle** skill whose body loads further skills. Nothing else distinguishes
 * the two.
 */
function loadedSkillsRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => LOADED_SKILLS_HEADING.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return [start, end];
}

/** One `- @…` line the indent-0 anchor read as value rather than as an address. */
export interface IndentedLoadSite {
  /** 1-based line number, so a report can point the author straight at it. */
  line: number;
  /** Width of the whitespace before the marker — a TAB counts as one. */
  indent: number;
  /** The line without its indent: the address the author meant to write. */
  text: string;
}

/** What a `## Loaded skills` section that produced no load site actually holds. */
export interface EmptyLoaderShape {
  /** The indented address-shaped lines, in document order. */
  indented: IndentedLoadSite[];
  /** Non-blank lines in the section body; `0` means the section is empty. */
  bodyLines: number;
}

/**
 * Measure a `## Loaded skills` section that yielded no load site, so a consumer
 * can say WHICH of the shapes behind `empty_loader` it is looking at.
 *
 * BB-436: that code covers three documents — a list that is wholly indented, a
 * section whose lines are not address-shaped at all (a `*` marker, a `-@` with no
 * space), and an empty section. Only the first is the "your list is indented" the
 * single message can describe; the other two get a remedy pointing at whitespace
 * that is already fine, which is the same misdirection the anchoring fixed.
 *
 * It lives HERE, not in the CLI that renders it: where the section starts and ends
 * and what counts as an address are rules of this module, and a second copy of
 * them in the host is exactly the drift this ticket is about. The host measures
 * (in `runValidate`) and renders (in `formatReport`); the rule stays in core.
 *
 * Answers for any document — a section it cannot find simply holds nothing — so a
 * caller need not pre-check. It classifies, never throws: the defect is already
 * raised by `expandLoad` before this is reached.
 */
export function measureEmptyLoader(workflowMd: string): EmptyLoaderShape {
  const lines = workflowMd.split('\n');
  const range = loadedSkillsRange(lines);
  if (range === null) return { indented: [], bodyLines: 0 };
  const [start, end] = range;

  const indented: IndentedLoadSite[] = [];
  let bodyLines = 0;
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '') continue;
    bodyLines++;
    const indent = raw.length - raw.trimStart().length;
    // Asks `BULLET_SHAPED` about the DE-indented line rather than restating its
    // body with a leading `\s+`: "address-shaped" keeps exactly one definition,
    // so this measurement cannot drift from the anchor it is explaining.
    if (indent > 0 && BULLET_SHAPED.test(raw.slice(indent))) {
      indented.push({ line: i + 1, indent, text: raw.trim() });
    }
  }
  return { indented, bodyLines };
}

/**
 * Read the per-skill value **overrides** from a `WORKFLOW.md`'s `## Loaded skills`
 * section. A project overrides a skill default **inline under that skill's bullet**
 * (indented `key: value` YAML, block scalars allowed), not in one global block.
 * Returns a map keyed by skill `name` (any `@<namespace>/` prefix stripped); a skill
 * with no overrides maps to `{}` (it runs on its declared defaults).
 */
export function parseStepValues(workflowMd: string): StepValues {
  return parseLoadedSection(workflowMd).values;
}

/** One `## Loaded skills` section, read in a single pass: order **and** values. */
interface LoadedSection {
  /** The bullet names in declared order (any `@<namespace>/` prefix stripped). */
  names: string[];
  /** The inline values per bullet; a bullet with none maps to `{}`. */
  values: StepValues;
}

/**
 * Scan a `## Loaded skills` section once and return both what it lists and what it
 * sets. Order and values come from the same pass, so they can never disagree — the
 * reason there is no separate name-only parser.
 *
 * Works on any document carrying the section: a project's `WORKFLOW.md` and a
 * **bundle** skill's markdown body are read by the exact same call.
 */
function parseLoadedSection(workflowMd: string): LoadedSection {
  const lines = workflowMd.split('\n');
  const range = loadedSkillsRange(lines);
  if (range === null) {
    throw new StepContractError(
      'WORKFLOW.md has no `## Loaded skills` section; a pure loader must carry one.',
    );
  }
  const [start, end] = range;

  const names: string[] = [];
  const values: StepValues = {};
  let current: string | null = null;
  let childIndent: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current === null) return;
    const yamlText = buffer.join('\n').trim();
    if (yamlText === '') {
      values[current] = {};
    } else {
      let parsed: unknown;
      try {
        parsed = parseYaml(yamlText);
      } catch (cause) {
        throw new StepContractError(
          `inline values for \`${current}\` are not valid YAML: ${(cause as Error).message}`,
        );
      }
      if (
        parsed == null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new StepContractError(
          `inline values for \`${current}\` must be a map of value keys to values.`,
        );
      }
      const inner: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new StepContractError(
            `inline value \`${current}.${k}\` must be a string.`,
          );
        }
        inner[k] = v;
      }
      values[current] = inner;
    }
    buffer = [];
    childIndent = null;
  };

  for (const raw of lines.slice(start + 1, end)) {
    const bullet = BULLET.exec(raw);
    if (bullet) {
      flush();
      current = bullet[2] ?? null; // group 2 = the name; group 1 = the namespace
      if (current !== null) names.push(current);
      continue;
    }
    if (BULLET_SHAPED.test(raw)) {
      // BB-436: a bullet the loader cannot read is a defect in the loader's
      // input, not prose. Reporting it here is what keeps the neighbour intact.
      throw new StepContractError(
        `\`## Loaded skills\` carries a bullet this loader cannot read: \`${raw.trim()}\` — write \`- @<namespace>/<skill-name>\`, lowercase with digits and \`-\` only.`,
      );
    }
    if (current === null) continue; // prose before the first bullet
    if (raw.trim() === '') {
      buffer.push('');
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      // dedented prose after the list ends the current skill's values
      flush();
      current = null;
      continue;
    }
    if (childIndent === null) childIndent = indent;
    buffer.push(raw.slice(Math.min(childIndent, indent)));
  }
  flush();
  return { names, values };
}

/** Split leading YAML frontmatter (`---` … `---`) from a skill markdown body. */
function readFrontmatter(skillMd: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(skillMd);
  if (!match) {
    throw new StepContractError('skill markdown has no YAML frontmatter.');
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '');
  } catch (cause) {
    throw new StepContractError(
      `skill frontmatter is not valid YAML: ${(cause as Error).message}`,
    );
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StepContractError('skill frontmatter must be a YAML map.');
  }
  return parsed as Record<string, unknown>;
}

/** Normalize a raw `when` value (string / list / `*` / omitted) to a `WhenValue`. */
function normalizeWhenValue(raw: unknown, key: string): WhenValue {
  if (raw === undefined || raw === null) return undefined;
  if (raw === '*') return '*';
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) {
    if (raw.some((v) => typeof v !== 'string')) {
      throw new StepContractError(
        `\`when.${key}\` list must contain only strings.`,
      );
    }
    if (raw.length === 0) {
      throw new StepContractError(`\`when.${key}\` list must not be empty.`);
    }
    return raw as string[];
  }
  throw new StepContractError(
    `\`when.${key}\` must be a string, a list of strings, \`*\`, or omitted.`,
  );
}

/**
 * Parse a skill's frontmatter into its `SkillContract` — the `when` triple (when
 * present) and the declared `inputs`. Malformed frontmatter raises `StepContractError`.
 */
export function readSkillWhen(skillMd: string): SkillContract {
  const fm = readFrontmatter(skillMd);
  const name = fm.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new StepContractError(
      'skill frontmatter must declare a string `name`.',
    );
  }

  let when: SkillWhen | undefined;
  if (fm.when !== undefined) {
    if (
      fm.when === null ||
      typeof fm.when !== 'object' ||
      Array.isArray(fm.when)
    ) {
      throw new StepContractError(`\`${name}\`: \`when\` must be a map.`);
    }
    const raw = fm.when as Record<string, unknown>;
    const allowed = new Set(['work_type', 'workflow', 'step']);
    for (const k of Object.keys(raw)) {
      if (!allowed.has(k)) {
        throw new StepContractError(
          `\`${name}\`: \`when.${k}\` is not a recognized key (work_type, workflow, step).`,
        );
      }
    }
    const step = normalizeWhenValue(raw.step, 'step');
    if (Array.isArray(step)) {
      for (const s of step) {
        if (!(WORKFLOW_STEPS as readonly string[]).includes(s)) {
          throw new StepContractError(
            `\`${name}\`: \`when.step\` value \`${s}\` is not a known workflow step.`,
          );
        }
      }
    }
    when = {
      work_type: normalizeWhenValue(raw.work_type, 'work_type'),
      workflow: normalizeWhenValue(raw.workflow, 'workflow'),
      step,
    };
  }

  const isBundle = loadedSkillsRange(skillMd.split('\n')) !== null;
  if (isBundle) {
    if (when !== undefined) {
      throw new StepContractError(
        `\`${name}\`: a bundle loads skills in its body and owns no step — it must declare no \`when\`.`,
      );
    }
    if (fm.inputs !== undefined) {
      throw new StepContractError(
        `\`${name}\`: a bundle declares no \`inputs\` — it carries values for its members, it takes none itself.`,
      );
    }
  }

  const inputs = readInputs(fm.inputs, name);

  const contract: SkillContract = { name, inputs };
  if (when !== undefined) contract.when = when;
  if (isBundle) {
    const section = parseLoadedSection(skillMd);
    if (section.names.length === 0) {
      throw new StepContractError(
        `\`${name}\`: the \`## Loaded skills\` section lists no skill.`,
      );
    }
    contract.loads = section.names;
    contract.values = section.values;
  }
  return contract;
}

/**
 * Parse the `inputs` declaration. Each input is a value key with a short
 * `description` and an optional `default` (used when `WORKFLOW.md` supplies no
 * override). The map form is canonical:
 *
 * ```yaml
 * inputs:
 *   test.command:
 *     description: shell command that runs the e2e suite
 *     default: ddev bakers-test-e2e
 * ```
 *
 * A bare string value is shorthand for `{ description: <string> }`, and a plain
 * list of keys (`inputs: [a, b]`) is accepted for description-less inputs.
 */
function readInputs(raw: unknown, name: string): InputDecl[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.map((k) => {
      if (typeof k !== 'string') {
        throw new StepContractError(
          `\`${name}\`: \`inputs\` list items must be strings.`,
        );
      }
      return { key: k };
    });
  }
  if (raw === null || typeof raw !== 'object') {
    throw new StepContractError(
      `\`${name}\`: \`inputs\` must be a map of key → { description, default } (or a list of keys).`,
    );
  }
  const decls: InputDecl[] = [];
  for (const [key, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof spec === 'string') {
      decls.push({ key, description: spec });
      continue;
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new StepContractError(
        `\`${name}\`: input \`${key}\` must be a string or a { description, default } map.`,
      );
    }
    const s = spec as Record<string, unknown>;
    if (s.description !== undefined && typeof s.description !== 'string') {
      throw new StepContractError(
        `\`${name}\`: input \`${key}\`.description must be a string.`,
      );
    }
    if (s.default !== undefined && typeof s.default !== 'string') {
      throw new StepContractError(
        `\`${name}\`: input \`${key}\`.default must be a string.`,
      );
    }
    const decl: InputDecl = { key };
    if (typeof s.description === 'string') decl.description = s.description;
    if (typeof s.default === 'string') decl.default = s.default;
    decls.push(decl);
  }
  return decls;
}

/** Does a normalized `when` value match a triple component? */
function componentMatches(
  whenVal: WhenValue,
  tripleVal: string | null,
): boolean {
  if (whenVal === undefined || whenVal === '*') return true;
  if (tripleVal === null) return false;
  return whenVal.includes(tripleVal);
}

/** Does a skill's `when` triple match a concrete project triple? */
function matchesTriple(when: SkillWhen, triple: Triple): boolean {
  return (
    componentMatches(when.work_type, triple.work_type) &&
    componentMatches(when.workflow, triple.workflow) &&
    componentMatches(when.step, triple.step)
  );
}

function tripleLabel(triple: Triple): string {
  return `(${triple.work_type ?? '—'}, ${triple.workflow}, ${triple.step})`;
}

/**
 * The **claimable states** of each bakers.build workflow — the only `step` values a ticket
 * in that workflow can ever present to a step owner.
 *
 * Source of truth: `web/modules/custom/bb_core/bb_core.workflows.yml`. It is
 * transcribed here rather than read, because this module is a pure library with no
 * filesystem and no Drupal access. A workflow added there must be added here too.
 */
export const WORKFLOW_CLAIMABLE_STATES: Record<
  string,
  readonly WorkflowStep[]
> = {
  bb_work: ['qualification', 'plan', 'working', 'review'],
  bb_deployment: ['pre_deployment', 'post_deployment'],
  bb_verification: ['verifying', 'summary'],
};

/**
 * Derive the `(work_type, workflow, step)` set a project can produce, from the
 * skills it loads plus the fixed workflow/claimable-state table above — the input
 * `validateLoad` needs, which until BB-436 only the contract test could build
 * (from a hardcoded list) and therefore no shipped command could.
 *
 * A **work type** exists for the project because some loaded **owner** declares it;
 * its participating steps are the union of `when.step` across every owner declaring
 * it. Those steps are then crossed against **every** workflow — not merely the
 * ones the declaring skill happens to list — because that is what makes a coverage
 * gap real rather than tautological: a project that can route `work:code` at
 * `working` must be able to route it at `working` in every workflow that claims there.
 *
 * A step no work type participates in carries a `null` work type (qualification,
 * the deployment and verification steps). An owner whose `when.work_type` is `*` or
 * omitted is a non-work-typed owner: it contributes to the `null` side, never to a
 * named work type. Helpers (no `when`) contribute nothing — they own no step.
 *
 * **Known blind spot: the work-type universe is derived from the load, not from the
 * project.** Because a work type exists here only if some loaded owner declares it,
 * deleting the last owner of a work type does not open a coverage gap — it shrinks
 * the triple set, and the validation stays green. Removing `- @bakers-build/docs-authoring`
 * from this repository's own `WORKFLOW.md` drops one owner and its triples, all
 * still covered, although every `work:docs` ticket would then reach `working`
 * with no owner at all. The set of work types a project's tickets can actually
 * carry lives in the ticket store's `work:*` vocabulary, which this function cannot
 * see; closing the gap means feeding that vocabulary in, which is its own change.
 * What is validated here is therefore: *given what the project loads, is the load
 * internally complete and unambiguous* — not *does the project load everything its
 * tickets need*.
 */
export function deriveProjectTriples(skills: SkillContract[]): Triple[] {
  const stepsByWorkType = new Map<string, Set<WorkflowStep>>();
  for (const skill of skills) {
    const when = skill.when;
    if (when === undefined) continue; // helper: owns no step
    const workTypes = when.work_type;
    if (workTypes === undefined || workTypes === '*') continue; // non-work-typed
    const steps: readonly WorkflowStep[] =
      when.step === undefined || when.step === '*'
        ? WORKFLOW_STEPS
        : (when.step as WorkflowStep[]);
    for (const workType of workTypes) {
      let set = stepsByWorkType.get(workType);
      if (set === undefined) {
        set = new Set<WorkflowStep>();
        stepsByWorkType.set(workType, set);
      }
      for (const step of steps) set.add(step);
    }
  }
  const workTypedSteps = new Set<WorkflowStep>();
  for (const set of stepsByWorkType.values())
    for (const step of set) workTypedSteps.add(step);

  const triples: Triple[] = [];
  const seen = new Set<string>();
  const push = (triple: Triple): void => {
    // JSON rather than a joined string: it keeps a `null` work type distinct from
    // any string one without inventing a sentinel character that a work type could
    // itself contain.
    const key = JSON.stringify([
      triple.work_type,
      triple.workflow,
      triple.step,
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    triples.push(triple);
  };
  for (const [workflow, states] of Object.entries(WORKFLOW_CLAIMABLE_STATES)) {
    for (const step of states) {
      if (!workTypedSteps.has(step)) {
        push({ work_type: null, workflow, step });
        continue;
      }
      for (const [workType, steps] of stepsByWorkType) {
        if (steps.has(step)) push({ work_type: workType, workflow, step });
      }
    }
  }
  return triples;
}

/** What a load expands to: the flat leaf skills plus the values that reached them. */
export interface ExpandedLoad {
  /** The leaf skills (step-owners + helpers), deduplicated, in first-seen order. */
  skills: SkillContract[];
  /** The effective per-skill values, keyed by skill name. */
  values: StepValues;
}

/**
 * Read a `WORKFLOW.md` and expand what it loads into the flat, deduplicated list of
 * **leaf** skills (step-owners + helpers) the project effectively runs, together with
 * the values that reach each leaf. One call is the whole load step: parse, expand,
 * resolve — hand the result straight to `validateLoad`.
 *
 * A **bundle** — a skill whose markdown body carries its own `## Loaded skills`
 * section, so its contract carries `loads` — is recursed into, in its declared
 * member order; a step-owner or helper is emitted as itself. Leaves are
 * deduplicated **by name, first occurrence wins**, so the result is deterministic
 * and idempotent — listing the same bundle twice, or a bundle plus one of its
 * members as an explicit bullet, yields each leaf exactly once in first-seen order.
 *
 * **Value precedence**, narrowest wins: the project's own inline override in
 * `WORKFLOW.md` beats a bundle's inline value for that member, which beats the
 * skill's declared `default` (resolved later, in `validateLoad`). Between nested
 * bundles the outermost wins, matching first-occurrence dedup.
 *
 * A root or member name absent from `byName`, or a cycle in the bundle graph,
 * raises a typed `StepContractError`. Bundles may nest (cycle-safe); bakers ships one
 * flat level. This never dispatches or routes.
 */
export function expandLoad(
  workflowMd: string,
  byName: Map<string, SkillContract>,
): ExpandedLoad {
  const { names: rootNames, values: workflowValues } =
    parseLoadedSection(workflowMd);
  // BB-436: a `## Loaded skills` section that yields no load site at all is its
  // own defect and needs its own message. Expanding it into an empty skill set
  // let the failure surface much later as `no skill matches triple (—,
  // bb_work, qualification) — coverage gap`, which sends the author looking
  // for a missing work-type skill when the real cause is almost always that their
  // list is indented — the one shape the indent-0 anchor turns into nothing.
  //
  // Here rather than in `parseLoadedSection`, because a BUNDLE that lists nothing
  // is reported by `readSkillWhen` with the bundle's own name in the message; a
  // check in the parser would displace that more specific report.
  if (rootNames.length === 0) {
    throw new StepContractError(
      'the `## Loaded skills` section carries no load site: write each skill as `- @<namespace>/<skill-name>` at indent 0. An indented `- @…` line is read as value, never as an address.',
      { code: 'empty_loader' },
    );
  }
  const skills: SkillContract[] = [];
  const emitted = new Set<string>();
  const values: StepValues = {};

  /** Record values for `name` without overwriting a narrower source already set. */
  const contribute = (name: string, from: Record<string, string>): void => {
    values[name] ??= {};
    const target = values[name];
    for (const [k, v] of Object.entries(from)) {
      if (!(k in target)) target[k] = v;
    }
  };

  const walk = (name: string, stack: string[]): void => {
    const skill = byName.get(name);
    if (skill === undefined) {
      const via =
        stack.length > 0
          ? `bundle \`${stack[stack.length - 1]}\` loads unknown skill \`${name}\``
          : `loaded skill \`${name}\` not found`;
      // BB-436: both halves are the same class of defect — a name that resolves
      // to nothing — and a consumer's remedy for them is identical ("that skill is
      // not vendored where the scan looked: pass `--skills`"). They are tagged
      // alike, with the unresolved name as data, so the host stops recovering it
      // from the message text and stops missing the bundle-member half entirely.
      throw new StepContractError(`${via}.`, {
        code: 'unresolved_skill',
        skill: name,
      });
    }
    if (skill.loads !== undefined) {
      if (stack.includes(name)) {
        throw new StepContractError(
          `cyclic skill bundle: ${[...stack, name].join(' → ')}.`,
        );
      }
      if (Object.keys(workflowValues[name] ?? {}).length > 0) {
        throw new StepContractError(
          `bundle \`${name}\` takes no inline values of its own — write the value under the member skill's own bullet.`,
        );
      }
      // The bundle's own inline values reach its members, but never beat an
      // override the project wrote in WORKFLOW.md (contributed first, below).
      for (const [member, memberValues] of Object.entries(skill.values ?? {})) {
        contribute(member, memberValues);
      }
      for (const member of skill.loads) walk(member, [...stack, name]);
      return;
    }
    if (emitted.has(name)) return;
    emitted.add(name);
    skills.push(skill);
  };

  // WORKFLOW.md's own overrides are contributed first, so they win every tie.
  for (const [name, own] of Object.entries(workflowValues))
    contribute(name, own);
  for (const name of rootNames) walk(name, []);
  return { skills, values };
}

/**
 * Validate a loaded set of skills against the project's triple set and per-skill values.
 *
 * For every `(work_type, workflow, step)` the project can produce, **exactly one**
 * loaded skill's `when` must match — a triple with no match (gap) or two matches
 * (collision) is a configuration error. Every `input` a matched skill declares must
 * resolve to a value: the `values` map (as resolved by `expandLoad`) or the input's
 * own declared `default`.
 *
 * Finally (BB-436) every override the load resolved must reach a declared input:
 * an override key no loaded skill declares is a defect, because it resolves to
 * nothing at all and the skill silently runs on its default instead.
 *
 * Reports the first defect as a typed `StepContractError`. Never dispatches or routes.
 */
export function validateLoad(
  skills: SkillContract[],
  values: StepValues,
  projectTriples: Triple[],
): void {
  const owners = skills.filter(
    (s): s is SkillContract & { when: SkillWhen } => s.when !== undefined,
  );

  for (const triple of projectTriples) {
    const matched = owners.filter((s) => matchesTriple(s.when, triple));
    if (matched.length === 0) {
      throw new StepContractError(
        `no skill matches triple ${tripleLabel(triple)} — coverage gap.`,
      );
    }
    if (matched.length > 1) {
      throw new StepContractError(
        `${matched.length} skills match triple ${tripleLabel(triple)} — collision: ${matched
          .map((s) => s.name)
          .join(', ')}.`,
      );
    }
    const owner = matched[0] as SkillContract & { when: SkillWhen };
    if (owner.inputs.length === 0) continue;
    const overrides = values[owner.name];
    for (const input of owner.inputs) {
      const effective = overrides?.[input.key] ?? input.default;
      if (effective === undefined) {
        const desc = input.description ? ` (${input.description})` : '';
        throw new StepContractError(
          `skill \`${owner.name}\` input \`${input.key}\`${desc} has no value: WORKFLOW.md sets no override and the skill declares no default (needed for triple ${tripleLabel(
            triple,
          )}).`,
        );
      }
    }
  }

  // BB-436: the loop above reads overrides only through the DECLARED inputs of a
  // matched owner (`overrides?.[input.key]`), so it never looks at an override key
  // the skill does not declare. Such a key resolves to nothing — the skill runs on
  // its default and the project's stated intent evaporates without a word. That is
  // how a key rename silently degraded eleven overrides on a consumer project for
  // six weeks. Sweep the loaded skills for it, and name both skill and key.
  //
  // Deliberately AFTER the triple loop, so a coverage gap or a collision is still
  // reported first with its own message; and over the `skills` LIST rather than the
  // `values` map, because `values` may legitimately carry entries for skills this
  // load does not contain. Owners and helpers alike: a helper is loaded precisely
  // for its inputs, so a dead override key on one is the same defect.
  for (const skill of skills) {
    const overrides = values[skill.name];
    if (overrides === undefined) continue;
    const declared = new Set(skill.inputs.map((i) => i.key));
    for (const key of Object.keys(overrides)) {
      if (declared.has(key)) continue;
      const known =
        declared.size === 0
          ? 'the skill declares no inputs at all'
          : `the skill declares \`${[...declared].join('`, `')}\``;
      throw new StepContractError(
        `skill \`${skill.name}\` has no input \`${key}\`: the override resolves to nothing and the skill silently runs on its default — ${known}. Rename the override to a declared key rather than deleting it.`,
      );
    }
  }
}
