import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  deriveProjectTriples,
  type EmptyLoaderShape,
  expandLoad,
  measureEmptyLoader,
  readSkillWhen,
  type SkillContract,
  StepContractError,
  type StepContractErrorCode,
  validateLoad,
} from '@bakers-build/core';
import type { Command } from 'commander';

// BB-436: `bakers validate` is the step contract's ENTRY POINT.
//
// `@bakers-build/core` has shipped `expandLoad` / `validateLoad` since BB-204, but
// nothing outside the contract test ever called them: the contract was enforced
// only where an agent happened to run it by hand, so a drifted `WORKFLOW.md`
// degraded in silence — on one consumer project, eleven overrides resolved to
// nothing for six weeks after a key rename, with no error anywhere.
//
// This command is deliberately thin. It discovers, delegates to core, and
// reports; every rule it enforces lives in `core/src/workflow/step-contract.ts`,
// so the CLI and the contract test can never drift apart. Enforcing the contract
// at conductor claim time was considered and rejected for this ticket — it needs
// its own rollout story, because it would start failing live claims.

/** Directory names never worth walking when hunting for `SKILL.md` files. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'vendor',
  '.ddev',
  'coverage',
]);

/** How deep below a skill root a `SKILL.md` may sit. `.claude/skills/<plugin>/skills/<name>/SKILL.md`
 *  is 3 directories below `.claude/skills`; a plugin cache adds a version segment. */
const MAX_SKILL_DEPTH = 5;

/** How many offending load sites the empty-loader report prints before eliding. */
const MAX_LISTED_LOAD_SITES = 5;

/**
 * The in-repo skill roots discovered without being told — the obvious two.
 *
 * The Claude **plugin cache** is deliberately NOT here. It would let a project
 * that does not vendor its skills validate with no `--skills`, but the cache holds
 * every installed version side by side (`cache/bakers/bakers/{0.18.0,0.19.0,0.20.0}/`),
 * so a scan would index whichever version it walked first and report `OK` against
 * a skill set weeks out of date — the exact silent degradation this command exists
 * to end. Resolving the cache needs a version choice made on purpose; until then a
 * consumer project passes `--skills`, and `formatReport` says so when a bullet
 * fails to resolve rather than letting a discovery gap wear a loader defect's
 * message.
 */
const DEFAULT_SKILL_ROOTS = ['.claude/skills', '.agents/skills'];

/** A `SKILL.md` whose frontmatter is not a readable skill contract. */
export interface SkillReadFailure {
  path: string;
  reason: string;
}

/** What the skill scan found: the name index, plus what it could not read. */
export interface SkillIndex {
  byName: Map<string, SkillContract>;
  /** Paths that parsed, in scan order — for the green summary's count. */
  indexed: string[];
  /** A later `SKILL.md` re-declaring an already-indexed name (first wins). */
  shadowed: { name: string; path: string }[];
  failures: SkillReadFailure[];
}

/** The verdict: `ok`, or the first contract defect with its message. */
export interface ValidateReport {
  ok: boolean;
  workflowPath: string;
  roots: string[];
  index: SkillIndex;
  /** Loaded leaf skills — owners plus helpers — when the load got that far. */
  loaded?: { owners: string[]; helpers: string[] };
  tripleCount?: number;
  error?: string;
  /**
   * The contract defect's classification, when core tagged one. BB-436: this is
   * the seam `formatReport` branches on — it replaced a regex over core's message
   * text, which matched only one of the two throw sites that need a hint and would
   * have broken silently the next time a message was reworded.
   */
  errorCode?: StepContractErrorCode;
  /** For `unresolved_skill`: the skill name the load could not resolve. */
  unresolvedSkill?: string;
  /**
   * For `empty_loader`: what the `## Loaded skills` section actually holds. Core
   * raises that code for three shapes and its message can only describe one of
   * them, so the shape is measured here and `formatReport` prints the remedy that
   * fits the document rather than the one that fits the common case.
   */
  emptyLoader?: EmptyLoaderShape;
}

/** Every `SKILL.md` under `root`, depth-capped, deterministic (name-sorted). */
function findSkillFiles(root: string, depth = 0): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // an absent or unreadable root is simply not a skill root
  }
  const found: string[] = [];
  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isFile() && entry.name === 'SKILL.md') {
      found.push(join(root, entry.name));
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || depth >= MAX_SKILL_DEPTH) continue;
    found.push(...findSkillFiles(join(root, entry.name), depth + 1));
  }
  return found;
}

/**
 * Index every skill reachable from `roots` by its declared `name` — the key a
 * `WORKFLOW.md` bullet resolves on, whatever namespace prefix the bullet wears.
 *
 * A `SKILL.md` that is not a readable bakers.build skill contract is RECORDED rather than
 * thrown on: a project's skill tree legitimately holds third-party skills that
 * declare no bakers.build frontmatter, and failing the whole validation over one of them
 * would make the command useless exactly where it is most needed. The record is
 * printed only when a bullet then fails to resolve, where it is the likely cause.
 */
export function indexSkills(roots: string[]): SkillIndex {
  const byName = new Map<string, SkillContract>();
  const indexed: string[] = [];
  const shadowed: { name: string; path: string }[] = [];
  const failures: SkillReadFailure[] = [];
  for (const root of roots) {
    for (const path of findSkillFiles(root)) {
      let contract: SkillContract;
      try {
        contract = readSkillWhen(readFileSync(path, 'utf8'));
      } catch (cause) {
        failures.push({ path, reason: (cause as Error).message });
        continue;
      }
      if (byName.has(contract.name)) {
        shadowed.push({ name: contract.name, path });
        continue; // first root wins, so the order of `roots` is the precedence
      }
      byName.set(contract.name, contract);
      indexed.push(path);
    }
  }
  return { byName, indexed, shadowed, failures };
}

export interface ValidateOptions {
  /** A project directory, or a loader document (`WORKFLOW.md`) directly. */
  path?: string | undefined;
  /** Project root for default skill-root discovery; defaults from `path`. */
  project?: string | undefined;
  /** Extra skill roots, in precedence order before the defaults. */
  skills?: string[] | undefined;
}

/** Resolve `path` into the loader document and the project root to scan from. */
function resolveTargets(options: ValidateOptions): {
  workflowPath: string;
  projectRoot: string;
} {
  const raw = options.path ?? process.cwd();
  const target = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  let isDir = false;
  try {
    isDir = statSync(target).isDirectory();
  } catch {
    // Not there: treat a bare directory-looking path as a directory so the
    // error names the WORKFLOW.md we went looking for.
    isDir = !target.endsWith('.md');
  }
  const workflowPath = isDir ? join(target, 'WORKFLOW.md') : target;
  const fallbackRoot = isDir ? target : dirname(target);
  const projectRoot =
    options.project === undefined
      ? fallbackRoot
      : resolve(process.cwd(), options.project);
  return { workflowPath, projectRoot };
}

/**
 * Validate a project's loader: read `WORKFLOW.md`, index the skills it can reach,
 * expand the load, derive the project's triple set, and enforce the contract.
 *
 * Returns the verdict rather than throwing, so the caller owns the exit code.
 */
export function runValidate(options: ValidateOptions = {}): ValidateReport {
  const { workflowPath, projectRoot } = resolveTargets(options);
  const roots = [
    ...(options.skills ?? []).map((d) => resolve(process.cwd(), d)),
    ...DEFAULT_SKILL_ROOTS.map((d) => join(projectRoot, d)),
  ];
  const index = indexSkills(roots);

  let workflowMd: string;
  try {
    workflowMd = readFileSync(workflowPath, 'utf8');
  } catch {
    return {
      ok: false,
      workflowPath,
      roots,
      index,
      error: `cannot read \`${workflowPath}\` — a bakers.build project's loader lives at its repository root.`,
    };
  }

  try {
    const { skills, values } = expandLoad(workflowMd, index.byName);
    const triples = deriveProjectTriples(skills);
    validateLoad(skills, values, triples);
    return {
      ok: true,
      workflowPath,
      roots,
      index,
      loaded: {
        owners: skills.filter((s) => s.when !== undefined).map((s) => s.name),
        helpers: skills.filter((s) => s.when === undefined).map((s) => s.name),
      },
      tripleCount: triples.length,
    };
  } catch (cause) {
    // A StepContractError is the product of this command; anything else is a bug
    // in it, and must not be dressed up as a contract defect.
    if (!(cause instanceof StepContractError)) throw cause;
    const report: ValidateReport = {
      ok: false,
      workflowPath,
      roots,
      index,
      error: cause.message,
    };
    // `exactOptionalPropertyTypes` is on: set these only when core supplied them.
    if (cause.code !== undefined) report.errorCode = cause.code;
    if (cause.skill !== undefined) report.unresolvedSkill = cause.skill;
    // Measured here, where the document is still in hand, and only for the code
    // that needs it — `formatReport` stays a pure function of the report.
    if (cause.code === 'empty_loader') {
      report.emptyLoader = measureEmptyLoader(workflowMd);
    }
    return report;
  }
}

/** Render the report for a terminal. Returns the lines, so tests can read them. */
export function formatReport(report: ValidateReport): string[] {
  const lines: string[] = [`workflow: ${report.workflowPath}`];
  lines.push(`skill roots: ${report.roots.join(', ')}`);
  lines.push(`skills indexed: ${report.index.indexed.length}`);
  if (report.ok) {
    const owners = report.loaded?.owners ?? [];
    const helpers = report.loaded?.helpers ?? [];
    lines.push(
      `OK — ${owners.length} step owner(s)${helpers.length > 0 ? ` + ${helpers.length} helper(s)` : ''} cover all ${report.tripleCount} project triple(s), every override resolves.`,
    );
    lines.push(`  owners: ${owners.join(', ')}`);
    if (helpers.length > 0) lines.push(`  helpers: ${helpers.join(', ')}`);
    for (const s of report.index.shadowed) {
      lines.push(`  note: \`${s.name}\` also declared at ${s.path} (ignored)`);
    }
    return lines;
  }
  lines.push(`FAILED: ${report.error}`);
  // An unresolved name is ambiguous on its own: the bullet (or the bundle body)
  // may name the wrong skill, or the skill may simply live somewhere this scan
  // never looked. Say which, so a discovery gap stops wearing a loader defect's
  // message.
  //
  // Branching on the CODE rather than on core's wording (BB-436 review) is what
  // brings the bundle-member half of that defect in: it is raised by the same
  // `walk()`, needs the same remedy, and the old message regex never matched it.
  if (report.errorCode === 'unresolved_skill') {
    lines.push(
      report.index.indexed.length === 0
        ? `  no \`SKILL.md\` was found under any scanned root, so nothing could resolve: pass \`--skills <dir>\` pointing at the skills this project loads.`
        : `  \`${report.unresolvedSkill}\` is not among the ${report.index.indexed.length} skill(s) found under the roots above — either the bullet names the wrong skill, or that skill is not vendored here: pass \`--skills <dir>\`.`,
    );
  }
  // The second code, and the reason it earns a branch (BB-436 review round 3).
  // `empty_loader` is raised for three documents but carries ONE message, whose
  // "an indented `- @…` line is read as value" fits only the first: a section
  // written with a `*` marker, or one with no line at all, has nothing indented,
  // and sending its author to look at whitespace is the same misdirection as the
  // `coverage gap` this code was introduced to replace. The shape decides the
  // remedy, and the offending lines are named — a report the message cannot give.
  if (report.errorCode === 'empty_loader') {
    const indented = report.emptyLoader?.indented ?? [];
    const bodyLines = report.emptyLoader?.bodyLines ?? 0;
    if (indented.length > 0) {
      lines.push(
        `  ${indented.length} address-shaped line(s) in that section sit below indent 0, so each was read as the preceding bullet's value — de-indent them to column 0:`,
      );
      for (const site of indented.slice(0, MAX_LISTED_LOAD_SITES)) {
        lines.push(
          `    line ${site.line} (indent ${site.indent}): ${site.text}`,
        );
      }
      if (indented.length > MAX_LISTED_LOAD_SITES) {
        lines.push(
          `    … and ${indented.length - MAX_LISTED_LOAD_SITES} more indented line(s)`,
        );
      }
    } else if (bodyLines > 0) {
      lines.push(
        `  indentation is NOT the defect here: the section's ${bodyLines} non-blank line(s) carry no \`- @…\` bullet at any indent. A load site is a \`-\`, one space, then \`@<namespace>/<skill-name>\` — a \`*\` marker, or a \`-@\` written without the space, is not one.`,
      );
    } else {
      lines.push(
        `  that section is empty: it carries no line between its heading and the next \`##\`, so there is nothing to move — add one \`- @<namespace>/<skill-name>\` bullet per skill the project loads.`,
      );
    }
  }
  // Only relevant on failure, and then usually the cause: a bullet that will not
  // resolve is very often a `SKILL.md` this scan could not read.
  for (const f of report.index.failures) {
    lines.push(`  unreadable skill: ${f.path} — ${f.reason}`);
  }
  return lines;
}

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description(
      "validate the project's WORKFLOW.md against the loaded skills' step contract",
    )
    .argument(
      '[path]',
      'project directory, or a WORKFLOW.md file directly (default: cwd)',
    )
    .option(
      '--project <dir>',
      'project root used to discover .claude/skills and .agents/skills',
    )
    .option(
      '--skills <dir>',
      'additional skill root to scan for SKILL.md (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .action(
      (
        path: string | undefined,
        opts: { project?: string; skills?: string[] },
      ) => {
        const report = runValidate({
          path,
          project: opts.project,
          skills: opts.skills,
        });
        const out = report.ok ? process.stdout : process.stderr;
        out.write(`${formatReport(report).join('\n')}\n`);
        if (!report.ok) process.exitCode = 1;
      },
    );
}
