import { check, outtakeChecks, visibleMarkdown } from '../outtake-checks.mjs';
import { requireValue } from '../validation.mjs';

const HEADING = '📖 Spec digest';
const PARTS = ['Entities', 'Architecture', 'Tests'];
const DEPTHS = ['emphasis', 'brief', 'neutral'];
// A reason attached to a test: what it proves or why it exists.
const REASON =
  /\b(?:because|so that|proves?|ensures?|why|catch(?:es)?|guards?|confirms?|verif(?:y|ies)|exercises?|reasons?)\b/gi;

export function validate(fixture) {
  const i = fixture?.input;
  requireValue(
    fixture.skill === 'bb-run-outtake' && i?.state === 'plan',
    'Expected a run-outtake spec fixture',
  );
  requireValue(
    typeof i.recipient_profile === 'string',
    'Expected input.recipient_profile (empty for no profile)',
  );
  requireValue(
    ['entities', 'decisions', 'tests'].every((k) => i.spec?.[k]?.length > 0),
    'Expected entity, decision and test facts',
  );
  requireValue(
    fixture.expect?.classes?.length > 0 &&
      DEPTHS.includes(fixture.expect.depth),
    'Expected expect.classes and expect.depth',
  );
  requireValue(
    (fixture.expect.depth === 'neutral') === !i.recipient_profile.trim(),
    'Only the neutral case has no profile',
  );
}

/** The digest section: from its heading to the next heading of the same or a higher level. */
export function digestSection(text) {
  const match = text.match(/^(#{1,6})\s+📖 Spec digest\s*$/m);
  if (!match) return undefined;
  const rest = text.slice(match.index + match[0].length);
  const end = rest.search(new RegExp(`^#{1,${match[1].length}}\\s`, 'm'));
  return end < 0 ? rest : rest.slice(0, end);
}

/** One labelled part: from its bold label to the next bold label. */
function part(digest, label) {
  const marker = (l) => digest.search(new RegExp(`\\*\\*\\s*${l}`, 'i'));
  const start = marker(label);
  if (start < 0) return '';
  const ends = PARTS.map(marker).filter((n) => n > start);
  return digest.slice(
    start + 2 + label.length,
    ends.length ? Math.min(...ends) : undefined,
  );
}

const wordCount = (text) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Every supplied fact surfaces with one of its own words, so a labelled but emptied part fails.
const covers = (text, facts) =>
  facts.every((fact) =>
    (fact.toLowerCase().match(/[a-z_]{6,}/g) ?? []).some((t) =>
      text.toLowerCase().includes(t),
    ),
  );

export function checkOutput(fixture, output) {
  const { spec } = fixture.input;
  const { classes, depth } = fixture.expect;
  const text = visibleMarkdown(output);
  const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1]);
  const digest = digestSection(text) ?? '';
  const words = wordCount(digest);
  const tests = part(digest, 'Tests');
  const testNames = spec.tests.flatMap(
    (t) => t.match(/\b[A-Z]\w+Test\b/g) ?? [],
  );
  const reasons = tests.match(REASON)?.length ?? 0;
  const checks = [
    ...outtakeChecks(output),
    check(
      'digest-placement',
      headings.filter((h) => h === HEADING).length === 1 &&
        headings[headings.indexOf('🎯 Outcome') + 1] === HEADING,
      'Exactly one 📖 Spec digest heading, directly after 🎯 Outcome',
    ),
    check(
      'digest-parts',
      digest &&
        PARTS.every((p) => digest.toLowerCase().includes(p.toLowerCase())),
      'The digest names Entities, Architecture and Tests',
    ),
    check(
      'digest-length',
      digest && words <= 200,
      `The digest stays within 200 words (observed ${words})`,
    ),
    check(
      'digest-entities',
      covers(part(digest, 'Entities'), spec.entities),
      'Entities states every supplied entity change, whatever the profile asks',
    ),
    check(
      'digest-classes',
      classes.some((c) => part(digest, 'Architecture').includes(c)),
      'Architecture names at least one key class or service',
    ),
    check(
      'digest-tests',
      testNames.every((n) => tests.includes(n)),
      'Tests names every planned test',
    ),
    check(
      'digest-self-contained',
      digest &&
        !/\bsee\b[^.\n]{0,30}\b(?:spec|review|below|above|comment)|spec comment/i.test(
          digest,
        ),
      'The digest defers nothing to the spec',
    ),
  ];
  // Depth is what the profile steers: the same spec reads longer with reasons, or terse without.
  if (depth === 'emphasis') {
    checks.push(
      check(
        'depth-emphasis',
        reasons >= testNames.length,
        `Tests gives a reason per planned test (observed ${reasons} for ${testNames.length})`,
      ),
    );
  }
  if (depth === 'brief') {
    checks.push(
      check(
        'depth-brief',
        words <= 90,
        `The terse profile gets at most 90 words (observed ${words})`,
      ),
    );
  }
  return checks;
}
