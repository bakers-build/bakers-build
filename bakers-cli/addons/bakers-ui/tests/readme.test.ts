import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// BB-257 (re-entry) AC-17 — the documentation states what the code does.
//
// The review's first observation: the README explained the `+N more` counter as
// an account of Drupal's 50-row page cap. It is not — it is
// `matches.length - shown.length`, the LOCAL render window's overflow, and the
// two are different quantities that happen to coincide when the bag is large and
// the query is empty. A doc that over-claims is a doc a reader plans against, so
// the wording is under test like any other contract.

const here = dirname(fileURLToPath(import.meta.url));

const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');

// Check the published reference as well as the package README so their
// behavioral contracts cannot drift. The reference lives in the repository's
// shared docs source as two pages read as one; a missing file must fail instead
// of skipping assertions.
const reference = ['bakers-ui/reference.md', 'bakers-ui-keys.md']
  .map((page) =>
    readFileSync(
      join(here, '..', '..', '..', '..', 'docs', 'addons', page),
      'utf8',
    ),
  )
  .join('\n');

/**
 * The text of one Markdown section, heading included.
 *
 * The siblings below already slice before asserting, for the reason a bare
 * `toContain` over a 300-line document cannot give: a phrase found somewhere
 * else in the file proves nothing about the section that must carry it.
 */
function section(doc: string, heading: string, until: RegExp): string {
  const start = doc.indexOf(heading);
  if (start === -1) throw new Error(`section not found: ${heading}`);
  const rest = doc.slice(start + heading.length);
  const end = rest.search(until);
  return heading + (end === -1 ? rest : rest.slice(0, end));
}

// The shared `Tab`/`Shift+Tab` note that follows each key table. Both documents
// open it with the same sentence, so one anchor slices both; the stop is
// `/\n##+ /` rather than `/\n## /` because the README's next heading is an `###`
// and a `## `-only stop would swallow 200 lines of unrelated section.
// Both are hard-wrapped prose at different column widths, so the slices are
// whitespace-normalised: a claim must be asserted as a SENTENCE, not as a line
// that happens to break where one document's wrapping put it.
const TAB_NOTE = '`Tab`/`Shift+Tab` mean two different things';
const unwrap = (text: string): string => text.replace(/\s+/g, ' ');
const readmeTabNote = unwrap(section(readme, TAB_NOTE, /\n##+ /));
const referenceTabNote = unwrap(section(reference, TAB_NOTE, /\n##+ /));

// BB-346 — the navigation section is where each document says WHERE a bar is
// drawn and what a click on the ticket level reaches. Both documents carry the
// heading verbatim, so one anchor slices both; the stop is `/\n##+ /` because the
// README's next heading is a `## ` but the reference's siblings are not
// guaranteed to be, and a wider stop cannot swallow the wrong section here.
// Unwrapped for the same reason as the tab note: the two are hard-wrapped at
// different widths and a claim is a sentence, not a line.
const readmeNavSection = section(
  readme,
  '## Navigation — seven scopes',
  /\n##+ /,
);
const referenceNavSection = section(
  reference,
  '## Navigation - seven scopes',
  /\n##+ /,
);
const readmeNav = unwrap(readmeNavSection);
const referenceNav = unwrap(referenceNavSection);
const referenceDeepLinks = unwrap(
  section(reference, '### Deep links are not a dead end', /\n### /),
);

// The ONE row of each key table that is the ticket screen's. The two documents
// head their key table differently (`## Screens & keys` vs `## Keybindings`), so
// the section is sliced first and the row looked up inside it — `| Ticket |`
// matches neither `| Tickets |` nor `| Ticket-Agents |`, and slicing first keeps
// it from finding the level table's `| Ticket | Ticket detail | …` row instead.
const readmeTicketKeyRow = section(
  section(readme, '## Screens & keys', /\n##+ /),
  '| Ticket |',
  /\n/,
);
const referenceTicketKeyRow = section(
  section(reference, '## Keybindings', /\n##+ /),
  '| Ticket |',
  /\n/,
);

// BB-376 AC-1 — the signal contract is a PUBLISHED contract: agents and hooks
// write that path forever, so the reference and the in-package copy must agree on
// it. Slice, then assert.
const referenceRefresh = section(
  reference,
  '## Auto-refresh - the `.bakers/ui-refresh` signal',
  /\n## /,
);
const readmeRefresh = section(
  readme,
  '### Auto-refresh (`.bakers/ui-refresh`)',
  /\n## /,
);

it('both documents name the signal file and the touch recipe (BB-376 AC-1)', () => {
  for (const doc of [referenceRefresh, readmeRefresh]) {
    expect(doc).toContain('touch .bakers/ui-refresh');
    expect(doc).toContain('300');
  }
});

it('both documents state that a screen without reload is not reloaded', () => {
  for (const doc of [referenceRefresh, readmeRefresh]) {
    expect(doc).toContain('reload');
  }
});

it.each([
  ['README', readmeTabNote],
  ['reference', referenceTabNote],
])('BB-309 B1: the %s attributes the suggestion walk to the PARENT FILTER only', (_name, note) => {
  // Both pickers are one-field autocompletes, but only the parent filter
  // passes a `KeyContext` carrying its field count
  // (`parent-filter-form.ts:128`); `who-filter-form.ts:117` calls
  // `keyToIntent(input, field)` with none, so `singleAutocomplete` is false
  // (`Form/keys.ts:29-30`) and `\x1b[Z` yields a `move` that a one-field form
  // clamps to nothing. The documents said the walk happened on "the two
  // single-field pickers"; it happens on one.
  expect(note).toMatch(/on the \*\*parent filter\*\*, the one picker that/);
  expect(note).toMatch(/through its suggestions/);
});

it.each([
  ['README', readmeTabNote],
  ['reference', referenceTabNote],
])('BB-309 B1: the %s no longer claims the walk for BOTH single-field pickers', (_name, note) => {
  // Absence is asserted, not only the presence of the replacement: a document
  // can carry both, and the false sentence is the one a reader plans against.
  expect(note).not.toMatch(/two single-field/);
  expect(note).not.toMatch(/single-field pickers/);
});

it.each([
  ['README', readmeTabNote],
  ['reference', referenceTabNote],
])('BB-309 B1: the %s names the Who picker as the one where the keys are field moves', (_name, note) => {
  // The gap is stated plainly rather than papered over — on the Who picker
  // both keys are field moves on a form with one field, i.e. inert.
  expect(note).toMatch(/\*\*Who picker\*\*[^.]*field moves/);
  expect(note).toMatch(/nowhere to move/);
});

it.each([
  ['README', readmeNav],
  ['reference', referenceNav],
])('BB-346: the %s says EVERY bar is drawn in the row under the header box', (_name, nav) => {
  // The chrome composes one bar row for every level, the `ticket` level
  // included (`Kernel/chrome.ts`); the ticket detail no longer draws its own bar
  // as the header box's last content row. The pre-BB-346 sentence named that
  // place as the ticket screen's — a reader told the bar is inside the box looks
  // for a click target one row too high, which is the concrete harm. Absence of
  // the falsified clause is asserted too, because a document can carry both.
  expect(nav).toMatch(/drawn in the same row/);
  expect(nav).toMatch(/under the header box/);
  expect(nav).not.toMatch(/header box's meta row/);
});

it.each([
  ['README', readmeNav],
  ['reference', referenceNav],
])('BB-346: the %s says a ticket-level bar click opens a SECTION', (_name, nav) => {
  // `Screen.selectTopTab` is offered the tab before the kernel navigates, so on
  // the ticket level the click switches a section of the open route and reaches
  // no project screen. The clickability paragraph is where a reader learns that,
  // and the level-agnostic wording is the whole point of the seam.
  expect(nav).toMatch(/On the ticket screen the same column may fall inside/);
  expect(nav).toMatch(/reaches no project screen/);
});

// The paragraph that explains why the labels get a row of their own. Sliced at
// its opening words and stopped at the blank line, because it is ONE claim and
// the sentence after it is a different one; unwrapped for the same reason as the
// tab note.
const LABELS = "The ticket's **labels**";
const readmeLabels = unwrap(section(readme, LABELS, /\n\n/));
const referenceLabels = unwrap(section(reference, LABELS, /\n\n/));

it.each([
  ['README', readme],
  ['reference', reference],
])('BB-346: the %s heads the ticket sections by that noun, not "detail tabs"', (_name, doc) => {
  // The widest-blast-radius occurrence, and the one the first sweep left
  // behind: a section HEADING is what a reader navigates by, so it names the
  // thing for the whole document under it. There is no detail tab bar to head
  // a section about — since this ticket the sections are entries of the top
  // bar, drawn by the chrome like every other level's.
  expect(doc).toMatch(/#+ The ticket sections\n/);
  expect(doc).not.toMatch(/#+ The ticket detail tabs/);
});

it.each([
  ['README', readmeLabels],
  ['reference', referenceLabels],
])('BB-346: the %s justifies the labels row without offering a tab bar to share', (_name, labels) => {
  // The rationale offered two rejected alternatives — appending to the title,
  // or sharing the row with the tab bar. The second is not an alternative any
  // more: the header box has no bar row to share, so a reader weighing the
  // decision is weighing it against something that cannot be built. The
  // surviving reason (a shared row is truncated by `fitLine`, so the labels
  // would appear or vanish by terminal width) is the one that is still true,
  // and is asserted so that dropping the dead half does not drop the claim.
  expect(labels).toMatch(/rather than appended to the title/);
  expect(labels).toMatch(/appear or vanish by terminal width/);
  expect(labels).not.toMatch(/tab bar/);
});

// BB-372 AC-4 — the Markdown section of each document, which is where the
// supported subset and its NAMED degradations are written out. An undocumented
// degradation is the one thing AC-4 rules out, so the three the code has and the
// table cannot express are pinned as sentences. The two documents head the
// section at different levels (`####` in the README, `###` in the reference)
// because they sit at different depths, so the anchor carries its own hashes;
// both are unwrapped for the reason the tab note is — they hard-wrap at different
// widths, and a claim is a sentence rather than a line.
const MARKDOWN = 'Markdown bodies render as Markdown';
const readmeMarkdown = unwrap(section(readme, `#### ${MARKDOWN}`, /\n##+ /));
const referenceMarkdown = unwrap(
  section(reference, `### ${MARKDOWN}`, /\n##+ /),
);

it.each([
  ['README', readmeMarkdown],
  ['reference', referenceMarkdown],
])('BB-372 AC-4: the %s says a backtick fence holding a backtick is NO fence', (_name, md) => {
  // CommonMark forbids a backtick in a backtick fence's info string. Reading
  // ```` ```code``` ```` as an opener dropped the row and printed nothing, so the
  // rule that keeps it a paragraph is a rule an operator can be surprised by in
  // the other direction — it belongs in the document, with the tilde exception.
  expect(md).toContain('```code```');
  expect(md).toMatch(/is \*\*not\*\* a fence/);
  expect(md).toMatch(/code span/);
  expect(md).toMatch(/no such restriction/);
});

it.each([
  ['README', readmeMarkdown],
  ['reference', referenceMarkdown],
])('BB-372 AC-4: the %s names the UNTERMINATED fence`s dropped opening row', (_name, md) => {
  // The degradation left in deliberately: the renderer reads one line at a time,
  // so it cannot know the closer never comes, and that row's info string is
  // metadata rather than content. Named, because a row that vanishes without a
  // documented reason is exactly what the criterion forbids.
  expect(md).toMatch(/unterminated/i);
  expect(md).toMatch(/opening row/);
});

it.each([
  ['README', readmeMarkdown],
  ['reference', referenceMarkdown],
])('BB-372 AC-4: the %s says CRLF is normalised before anything is parsed', (_name, md) => {
  // A description authored through the control plane's web form arrives CRLF, so
  // "which editor wrote this body" would otherwise be a thing an operator has to
  // know to predict the rendering.
  expect(md).toMatch(/CRLF/);
  expect(md).toMatch(/normalised/);
  expect(md).toMatch(/renders identically/);
});

it.each([
  ['README', readmeTicketKeyRow],
  ['reference', referenceTicketKeyRow],
])('BB-346: the %s key table says Tab switches a SECTION on the ticket screen', (_name, row) => {
  // The screen's own status hint reads `Tab section`
  // (`Entity/ticket/Screen/ticket-detail.ts`), and a section is a mode of the
  // open route rather than a tab you navigate to. "Detail tab" was the word for
  // the bar the ticket screen used to draw itself.
  expect(row).toMatch(/switch section/);
  expect(row).not.toMatch(/detail tab/);
});

// BB-377 AC-4 — leftover operator docs still called Users "planned" and
// windowed tickets on each entity's `created`. The TUI meta line already names
// closed_date / created; both documents must match the shipped surface.
const readmeKeys = section(readme, '## Screens & keys', /\n##+ /);
const referenceKeys = section(reference, '## Keybindings', /\n##+ /);

it.each([
  ['README', readmeNav],
  ['reference', referenceNav],
])('the %s documents Members as a team tab', (_name, nav) => {
  expect(nav).toMatch(/\*\*Members\*\*/);
  expect(nav).not.toMatch(/Members[^*]*planned/i);
});

it.each([
  ['README', readmeNavSection],
  ['reference', referenceNavSection],
])('the %s documents the exact revision-3 seven-scope sitemap', (_name, nav) => {
  expect(nav).toMatch(/^## Navigation [-—] seven scopes/);
  expect(nav).toMatch(/Navigation has seven tab scopes/);
  for (const [level, tabs] of [
    [
      'Root',
      '**My work** · **Projects** · **Teams** · **Members** (workspace lead only) · **Conductors**',
    ],
    [
      'Project',
      '**Overview** · **Work** · **Tickets** · **Ticket-Agents** · **Runs** · **Conductors**',
    ],
    [
      'Ticket',
      '**Overview** · **Planning** · **History** · **Runs**, plus enabled tabs such as **Artifacts**; a message addon is an Overview card',
    ],
    ['Team', '**Overview** · **Work** · **Members**'],
    ['Workspace member', '**Overview** · **Tickets** · **Runs**'],
    ['Team member', '**Overview** · **Tickets** · **Runs**'],
  ]) {
    expect(section(nav, `| ${level} |`, /\n/)).toContain(tabs);
  }
  expect(nav).not.toMatch(/^\| User \|/m);
  expect(nav).not.toMatch(/\*\*Dashboard\*\*/);
});

it.each([
  ['README', readme],
  ['reference', reference],
])('the %s documents neither statistics nor ticket creation', (_name, doc) => {
  expect(doc).not.toMatch(
    /\*\*Stats\*\*|Stats figures|\/jsonapi\/bakers\/statistics/,
  );
  expect(doc).not.toMatch(/new-ticket popup|`n` new ticket/i);
});

it('the README key table makes member rosters navigable', () => {
  const row = section(readmeKeys, '| Workspace/Team Members |', /\n/);
  expect(row).toMatch(/↑↓.*select|select/);
  expect(row).toMatch(/Enter.*open member/);
});

it('the reference key table makes contextual member rosters navigable', () => {
  const row = section(referenceKeys, '| Workspace/Team Members |', /\n/);
  expect(row).toMatch(/↑↓.*select|select/);
  expect(row).toMatch(/Enter.*open member/);
});

it('the README documents contextual team-member navigation', () => {
  expect(readmeNav).toMatch(/\*\*Team Members\*\* is a read-only OG roster/);
  expect(readmeNav).toContain('Root → Teams → one team');
  expect(readmeNav).toMatch(/Enter opens that person inside the selected team/);
});

it('the reference documents contextual team-member navigation', () => {
  expect(referenceNav).toMatch(/\*\*Team Members\*\* is a read-only OG roster/);
  expect(referenceNav).toContain('Root → Teams → one team');
  expect(referenceNav).toMatch(
    /Enter opens that person inside the selected team/,
  );
});

it('the reference documents the project deep-link escape fallbacks', () => {
  expect(referenceDeepLinks).toMatch(
    /ticket, run, addon tab, or picker.*Esc.*opens \*\*My work\*\*/,
  );
  expect(referenceDeepLinks).toMatch(
    /direct project deep link opens Work.*Esc.*root-level project list/,
  );
  expect(referenceDeepLinks).toMatch(
    /Other project tabs preserve the selected project.*registered project fallback/,
  );
  expect(referenceDeepLinks).not.toMatch(
    /project.*empty history.*opens \*\*My work\*\*/,
  );
});
