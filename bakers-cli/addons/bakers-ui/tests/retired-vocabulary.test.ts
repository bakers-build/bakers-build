import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// BB-346 A8(b) — THE RETIRED VOCABULARY, ENUMERATED OVER THE PACKAGE TREE.
//
// Three review rounds each returned `Not OK` on the same genus: a statement, a
// name or a number that outlived the code it describes. None of them found a
// behavioural defect, and every one of them missed the next batch for the same
// reason — each sweep was scoped to THE DIFF, and the falsified statements sat
// in files the diff never touched. `render-geometry.test.ts` was last edited by
// BB-340 and carried five present-tense claims that this ticket falsified; a
// diff-scoped sweep cannot see it, however carefully it is run.
//
// So the domain of this guard is the PACKAGE TREE, not the diff. It walks
// `src/`, `tests/` and `tests-bun/`, matches four patterns of retired
// vocabulary, and fails on any occurrence that is not on the allowlist below.
// An occurrence is on that list only with a written reason for why it is a
// RECORD OF THE PAST rather than a statement about the present.
//
// WHY A FILE OF ITS OWN, beside `readme.test.ts` rather than inside it. That
// file's domain is two named documents and every helper in it slices Markdown
// sections; this one's domain is a directory tree and it shares no machinery
// with it. Keeping them apart also keeps the failure messages honest — a
// reader who breaks this check is told about a source tree, not about a README.
//
// DELIBERATELY OUT OF DOMAIN: `docs/` and this ticket's evidence
// files. Those are RECORDS. `docs/specs/BB-239|241|255|272|285`, the
// `docs/superpowers/` plans and specs, `docs/evidence/BB-340` and
// `docs/specs/DRAFT-bakers-ui-entity-slices.spec.md` (whose own header declares it
// measured on a named branch on a named date, and not scheduled work) state what
// was true when they were written and must not be rewritten to match today's
// code. The two documents that DO state the present — `README.md` and
// `docs/addons/bakers-ui.md` — stay pinned by `readme.test.ts`, which
// asserts their claims sentence by sentence rather than grepping them.

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

/** The trees this guard owns. Anything else is out of domain by construction. */
const ROOTS = ['src', 'tests', 'tests-bun'];
/** Source files only — a `.map`, a `.json` or a prebuilt binary states nothing. */
const SOURCE_EXTENSIONS = ['.ts', '.mjs', '.js'];
/**
 * Never walked. `tests/pty/node_modules` really is on this tree (the pty drivers
 * install `node-pty` beside themselves), and a build output is a copy of `src/`
 * that would double every finding.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
/**
 * This file itself, and only this file.
 *
 * Every occurrence of the retired vocabulary in it is either a pattern that
 * DEFINES the search or a line QUOTED from somewhere else so that a reason can
 * be attached to it. Including it would need one self-referential allowlist
 * entry per real entry — the list would double, each pair would have to be kept
 * in step by hand, and not one of those entries would say anything a reader did
 * not already read two lines above. The judgements themselves are not lost:
 * every line quoted here is checked where it lives.
 */
const SELF = 'tests/retired-vocabulary.test.ts';

/**
 * The four retired patterns.
 *
 * Each names a thing BB-346 retired, and each is broad enough to catch the
 * NEXT occurrence rather than only the ones a reviewer already enumerated:
 *
 *  - the retired NOUN. The ticket screen's four sections were a "detail tab
 *    bar" it drew itself, as the last content row of its header box. They are
 *    entries of the top-tab registry's `ticket` level now, drawn by the chrome.
 *  - the retired INVARIANT. BB-239 was read as "the ticket detail screen draws
 *    NO top-level bar". Its real subject is `exactly one bar, of this screen's
 *    own level` — which is what it still guarantees, now that the ticket screen
 *    HAS a level.
 *  - the retired LEVEL COUNT. There are three levels; `either`/`both` counting
 *    them is false. (A sentence naming root and project SPECIFICALLY is not —
 *    see the allowlist.)
 *  - the retired SHAPE. `chromeShape(3, false)` — three box content rows and NO
 *    bar row — is what the ticket screen HAD, its own sections drawn as the box's
 *    last content row. That shape is six rows tall, exactly like the
 *    `chromeShape(2, true)` that replaced it, which is why a stale constant kept
 *    passing while being wrong and why it needs a guard rather than a test.
 *
 *    BB-369 NARROWED THIS PATTERN from `chromeShape(3` to the `false` variant,
 *    and the narrowing is the point rather than an escape. The ticket screen's
 *    shape is `chromeShape(3, true)` now — three content rows (title, labels,
 *    state) AND the chrome's bar row, SEVEN rows — a shape that shares a leading
 *    `3` with the retired one and nothing else: different height, different bar
 *    ownership, different reason. Left as written, this pattern would have
 *    forbidden the present tense along with the past, which is the opposite of
 *    what it is for. What stays forbidden is the `false` — the box drawing its own
 *    bar — and every allowlisted record below quotes that variant, so all of them
 *    still match.
 */
const PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'the retired noun', re: /detail\s+(tab|bar)s?/i },
  { name: 'the retired noun', re: /detailTab/ },
  { name: 'the retired invariant', re: /(draws?|drew|draw)\s+no\s+top-level/i },
  { name: 'the retired level count', re: /\b(either|both)\s+levels?\b/i },
  // BB-369 narrowed this from `chromeShape(3` — see the docblock above; the
  // ticket screen's PRESENT shape is `chromeShape(3, true)`, so only the `false`
  // variant is still the retired one.
  { name: 'the retired shape', re: /chromeShape\(3,\s*false/ },

  // ── BB-372: the retired MARKDOWN vocabulary ──────────────────────────────
  //
  // The same genus, one ticket later, and it earned its entry the same way: this
  // guard passed while `markdownRow`'s own doc comment claimed to be the function
  // "every renderer of a body line goes through" — which had just stopped being
  // true — because BB-346's five patterns cannot see a sentence about Markdown.
  // A guard scoped to one ticket's wording only ever catches that ticket.
  //
  //  - the retired SCOPE. `markdownRow` has ONE caller left (the run log, D9). No
  //    renderer of a `bb_rich` body goes through it: a body reaches a row as a
  //    `MarkdownLine` and a plain string is not parsed at all (D3).
  //  - the retired CAPABILITY. "Bullets and code fences stay raw by design" was
  //    the explicit v1 decision and is now false for a ticket body — bullets
  //    become `•`, a fence's rows are dropped and its content is drawn cyan.
  //  - the retired NAME for the rule. "minimal markdown" described a four-line
  //    ATX-only rule. The ticket detail's rule is `lib/markdown.ts`'s subset; only
  //    the run log's is still minimal, which is what its allowlist entry says.
  {
    name: 'the retired markdown scope',
    re: /every renderer of a body line/i,
  },
  {
    name: 'the retired markdown capability',
    re: /stays?\s+raw\s+by\s+design/i,
  },
  { name: 'the retired rule name', re: /minimal[- ]markdown/i },
];

interface Occurrence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly pattern: string;
}

/**
 * An occurrence that is allowed to stay, and WHY.
 *
 * Matched on the quoted TEXT, never on a line number: a line that moves must not
 * break this guard, and a line whose wording changes must. `file` is part of the
 * key so that the same sentence appearing in a second file is judged again
 * rather than inheriting a reason written about somewhere else.
 */
interface Allowed {
  readonly file: string;
  readonly text: string;
  readonly reason: string;
}

const ALLOWLIST: readonly Allowed[] = [
  // ── `readme.test.ts`: the guard that FORBIDS the noun has to quote it ────────
  {
    file: 'tests/readme.test.ts',
    text: `])('BB-346: the %s heads the ticket sections by that noun, not "detail tabs"', (_name, doc) => {`,
    reason:
      'the document guard names the retired heading in order to assert it is gone',
  },
  {
    file: 'tests/readme.test.ts',
    text: '// thing for the whole document under it. There is no detail tab bar to head',
    reason: 'states the noun\'s ABSENCE — "there is no detail tab bar"',
  },
  {
    file: 'tests/readme.test.ts',
    text: 'expect(doc).not.toMatch(/#+ The ticket detail tabs/);',
    reason:
      'the assertion that the retired heading is absent from both documents',
  },
  {
    file: 'tests/readme.test.ts',
    text: '// open route rather than a tab you navigate to. "Detail tab" was the word for',
    reason: 'past tense — "was the word for" the bar the screen used to draw',
  },
  {
    file: 'tests/readme.test.ts',
    text: 'expect(row).not.toMatch(/detail tab/);',
    reason: 'the assertion that the key table no longer says it',
  },

  // ── past-tense records of what the sections used to be ──────────────────────
  {
    file: 'tests/Screen/ticket-detail.test.ts',
    text: "* This used to read the detail bar's text out of the header tree by its node id",
    reason: 'past tense — what this helper did before the sections moved',
  },
  {
    file: 'tests/Screen/reload.test.ts',
    text: "* This read the detail bar's text out of the header tree by its node id until the",
    reason: 'past tense — "until the sections became entries of the registry"',
  },
  {
    file: 'tests/Kernel/chrome.test.ts',
    text: '* published beside its own text (`detailTabSpans`). That was the last',
    reason:
      'past tense — names the deleted span map under a heading reading GONE WITH THE `string[]` HEADER',
  },
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: "* It was `chromeShape(3, false)`: title, labels and the screen's own detail bar",
    reason:
      'explicitly past tense ("It was"), and the correct record of what this ticket changed',
  },
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: '* `detailTabBarTree` and compared against a `metaRow(...)` INSIDE the header box.',
    reason: 'past tense — what `ticketBarRow` replaced',
  },
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: '// "the detail bar is unchanged in content and position" are ONE case: one bar,',
    reason: 'quotes the two OLD case names this describe merged, as history',
  },
  {
    file: 'tests-bun/Kernel/route-boot.test.ts',
    text: '// `topTabSpans`/`detailTabSpans` column maps it replaced in BB-340 Task 11).',
    reason: 'past tense — names the column maps `topTabParts` REPLACED',
  },
  {
    file: 'tests-bun/Kernel/route-boot.test.ts',
    text: '// (the old detail bar started one column further right and joined with one space',
    reason:
      'past tense — "the old detail bar", explaining why a column is unchanged',
  },

  // ── the retired bar asserted ABSENT: a case that must name what it forbids ──
  {
    file: 'tests-bun/Kernel/ticket-sections.test.ts',
    text: "it('no row draws a detail bar of the old shape', async () => {",
    reason:
      'the case asserts the retired bar is absent, so it has to name it — renaming it would hide what it guards',
  },

  // ── the retired SHAPE, where it is the subject of an A7 before/after ────────
  {
    file: 'tests/Kernel/chrome.test.ts',
    text: 'const before = chromeShape(3, false); // title, labels, detail bar; no bar row',
    reason:
      "A7's before/after equality: the binding is literally named `before`, and this shape is the thing the equality is asserted AGAINST",
  },

  // ── `both levels` naming root and project SPECIFICALLY — not a level count ──
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: '* column 2. BB-256 put `Dashboard` first on both levels, so the',
    reason:
      'BB-256 put `Dashboard` first on root and project; the ticket level has no `Dashboard` at all',
  },
  {
    file: 'tests-bun/Kernel/route-boot.test.ts',
    text: '//          BB-256 put `Dashboard` first on BOTH levels, so the project bar is',
    reason:
      'the same two named levels — the column arithmetic under it is the project bar’s',
  },

  // ── BB-346's own corrections: the retired reading, quoted as retired ──────
  //
  // Each of these is a line this ticket WROTE, in place of a line that stated the
  // same thing in the present tense. Quoting the retired wording is deliberate:
  // it is what a reader coming from the old code greps for, and a correction that
  // silently drops the old words leaves them with nothing to land on.
  {
    file: 'tests-bun/Kernel/render-geometry.test.ts',
    text: '// `chromeRowCount(chromeShape(3, false))`: three box content rows — title,',
    reason:
      'past tense — quotes the expression the deleted `TICKET_CHROME` held, to say what it modelled',
  },
  {
    file: 'tests-bun/Kernel/render-geometry.test.ts',
    text: '// BB-239 used to be read here as "the ticket screen draws no top-level bar",',
    reason:
      '"used to be read here as" — the retired READING of BB-239, quoted so the sentence after it can say what its subject really is',
  },
  {
    file: 'tests-bun/Kernel/route-boot.test.ts',
    text: '// BB-239 closed it by suppressing the row — it drew no top-level bar at all,',
    reason:
      'past tense — how BB-239 closed the AC-14 gap, before BB-346 closed it the other way',
  },
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: '* "Either level" is what this said while there were two, and it stayed while',
    reason:
      'quotes the retired count in order to record that it outlived its code — the sentence above it says THREE',
  },
  {
    file: 'tests-bun/Kernel/top-tab-bar.test.ts',
    text: '// BB-239 was read as "the ticket screen draws no top-level tab bar", and',
    reason:
      '"was read as" — the retired reading, quoted before the sentence that states the real subject',
  },

  // ── BB-372's own corrections, and the ONE rule that is still minimal ──────
  {
    // BB-372 D11 moved `markdownRow` — and this quotation with it — out of
    // `Component/section-list` and into `Component/markdown/`, which is where all
    // Markdown lives now. The quoted sentence is unchanged; only its file is, which
    // is exactly the drift this second direction of A8(b) exists to catch.
    file: 'src/Component/markdown/index.ts',
    text: '* function, because every renderer of a body line goes through it". Since',
    reason:
      'quoted as retired — the sentence around it reads "ITS DOC COMMENT ONCE CLAIMED THE OPPOSITE OF WHAT IS NOW TRUE"; `markdownRow` has one caller left (D9)',
  },
  {
    file: 'src/Entity/run/Component/run-detail/index.ts',
    text: "// The log's OWN minimal-markdown rule (BB-372 D9): an ATX heading inside",
    reason:
      'STILL TRUE, and the only place it is: the run log keeps the ATX-only rule on purpose, because a log entry is machine output and a renderer meant for prose would delete characters from it (D9). "OWN" is what distinguishes it from the ticket detail`s subset.',
  },
  {
    file: 'tests/Entity/ticket/Component/ticket-detail/index.test.ts',
    text: '// BB-372 corrected two claims this comment used to make. It said "MINIMAL',
    reason:
      'quotes the retired name in order to say it is retired — the sentences after it state what the rule is now and that the asserted behaviour is unchanged',
  },
];

const isSource = (name: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));

function walk(directory: string, found: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, found);
    } else if (isSource(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Every source file of the guarded trees, path relative to the package root. */
const sourceFiles = (): string[] =>
  ROOTS.flatMap((root) => walk(join(packageRoot, root), []))
    .map((file) => relative(packageRoot, file).split(sep).join('/'))
    .filter((file) => file !== SELF);

/**
 * A line, plus the line after it with its comment marker stripped.
 *
 * WHY, and it is not hypothetical: this guard is line-based, and while writing
 * the corrections below one of them landed as `… drew no` / `// top-level bar at
 * all,` — a retired phrase split by a line break, which every pattern here would
 * have walked straight past. Hard-wrapped prose is most of what this guard reads,
 * so a wrap is not an edge case, it is the normal case. Matching each line joined
 * to its successor closes it.
 *
 * The occurrence is still REPORTED as the first of the two lines, because that is
 * what an allowlist entry has to quote and what a reader has to find. So a wrapped
 * phrase is keyed on where it starts; move the wrap and the key changes, which is
 * the same rule as any other wording change.
 *
 * A joined match counts only when the phrase REALLY spans the break — when the
 * second line matches on its own, it reports itself and the line above it is not
 * a second occurrence of the same sentence.
 */
const joinedWithNext = (lines: string[], index: number): string => {
  const next = lines[index + 1];
  if (next === undefined) return lines[index];
  return `${lines[index]} ${next.replace(/^\s*(\/\/|\*)\s*/, '')}`;
};

const occurrences = (): Occurrence[] => {
  const found: Occurrence[] = [];
  for (const file of sourceFiles()) {
    const lines = readFileSync(join(packageRoot, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const next = lines[index + 1] ?? '';
      const wrapped = joinedWithNext(lines, index);
      for (const { name, re } of PATTERNS) {
        const spansTheBreak = re.test(wrapped) && !re.test(next);
        if (re.test(line) || spansTheBreak) {
          found.push({
            file,
            line: index + 1,
            text: line.trim(),
            pattern: name,
          });
          break;
        }
      }
    });
  }
  return found;
};

const key = (file: string, text: string): string => `${file} ${text}`;
const allowed = new Set(ALLOWLIST.map((entry) => key(entry.file, entry.text)));

it('A8(b): no retired vocabulary states the present anywhere in the package tree', () => {
  const unlisted = occurrences().filter(
    (found) => !allowed.has(key(found.file, found.text)),
  );
  const report = unlisted
    .map(
      (found) =>
        `  ${found.file}:${found.line}  [${found.pattern}]\n      ${found.text}`,
    )
    .join('\n');
  expect(
    unlisted,
    unlisted.length === 0
      ? ''
      : `BB-346 A8(b) — ${unlisted.length} occurrence(s) of retired vocabulary are not on the allowlist:\n${report}\n\n` +
          'Decide for each one:\n' +
          '  · if it states the PRESENT, fix the file — the ticket screen has the `ticket` level,\n' +
          "    its bar is the chrome's bar row, its shape is `chromeShape(3, true)` since BB-369\n" +
          '    put a state row in its header box, and there are THREE levels.\n' +
          '  · if it records the PAST, add it to ALLOWLIST in tests/retired-vocabulary.test.ts with\n' +
          '    its own one-line reason for why it is a record and not a claim.\n' +
          'Entries match on the quoted TEXT, so paste the line as it reads after trimming.',
  ).toEqual([]);
});

it('A8(b): every allowlist entry still matches a line that is really there', () => {
  // The other direction, and the reason the list cannot rot: correcting an
  // allowlisted line, or moving it to another file, leaves an entry whose
  // written reason no longer describes anything. Without this the list would
  // grow monotonically and each stale reason would make the next reader's
  // judgement harder.
  const present = new Set(
    occurrences().map((found) => key(found.file, found.text)),
  );
  const stale = ALLOWLIST.filter(
    (entry) => !present.has(key(entry.file, entry.text)),
  ).map((entry) => `  ${entry.file}\n      ${entry.text}`);
  expect(
    stale,
    stale.length === 0
      ? ''
      : `BB-346 A8(b) — ${stale.length} allowlist entry/entries match nothing:\n${stale.join('\n')}\n\n` +
          'The line was corrected, moved to another file, or its wording changed. Drop the entry,\n' +
          'or re-quote it — a reason that describes no line is a reason nobody can check.',
  ).toEqual([]);
});
