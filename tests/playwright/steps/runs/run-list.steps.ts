// BB-482 — the project and team Runs tabs, whose facet transport only a
// browser can see. Reuses `support/steps/listing.steps.ts`'s facet-picking, chip and
// address steps verbatim: the flat canvas the runs tabs use is the same
// mechanism `project_tickets`/`team_tickets` already exercise, and those
// steps are already written and must not be duplicated.
import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect } from '@playwright/test';
import { CONTENT_ISLAND } from '../../support/shell';
import { markDocument } from '../../support/shell';
import { resetOverridePage } from '../../support/listing';

/** Whatever a Gherkin string may not smuggle into a shell or into PHP. */
function safe(value: string): string {
  return value.replace(/["'\\$]/g, '');
}

/** Runs one PHP snippet through drush and returns its output, single-quoted. */
function php(snippet: string): string {
  if (snippet.includes("'")) {
    throw new Error('A drush snippet must not contain a single quote.');
  }
  return Drush.exec(`ev '${snippet}'`).trim();
}

/** The last visited runs tab's response status, for the tenancy scenario. */
let lastStatus = 0;

Given('the run index is up to date', async () => {
  lastStatus = 0;
  // `support/steps/listing.steps.ts`'s closed-position steps (BB-490), reused here,
  // read `listing.page` from `support/listing.ts` — set by the ticket list's no-JavaScript step
  // and the shared fresh-tab step in `support/steps/listing.steps.ts`, and never reset by this
  // file's own Background. Each
  // Playwright worker process runs every feature file assigned to it, one
  // after another, in one Node process, so a stale value a `ticket-list`
  // scenario set earlier on the same worker would otherwise leak into the
  // runs tab.
  resetOverridePage();
  // Adds pending items to the shared index and removes nothing; this scenario's
  // assertions are scoped to its own project's runs, so a concurrent worker
  // indexing its own additions in parallel changes nothing this scenario reads.
  Drush.exec('search-api:index bb_runs');
});

function projectRunsUrl(name: string): string {
  const url = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $e->toUrl()->toString() : "");`,
  );
  if (!url) {
    throw new Error(`No bb_project named "${name}" exists in the seeded world.`);
  }
  return `${url}/runs`;
}

function teamRunsUrl(name: string): string {
  const url = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_team")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $e->toUrl()->toString() : "");`,
  );
  if (!url) {
    throw new Error(`No bb_team named "${name}" exists in the seeded world.`);
  }
  return `${url}/runs`;
}

When('I visit the runs tab of project {string}', async ({ page }, name: string) => {
  const response = await page.goto(projectRunsUrl(name));
  lastStatus = response?.status() ?? 0;
  if (lastStatus < 400) {
    await markDocument(page);
  }
});

When('I visit the runs tab of team {string}', async ({ page }, name: string) => {
  const response = await page.goto(teamRunsUrl(name));
  lastStatus = response?.status() ?? 0;
  if (lastStatus < 400) {
    await markDocument(page);
  }
});

Then('the run listing is rendered inside the bakers.build shell', async ({ page }) => {
  await expect(page.locator('[data-component-id="bb_theme:shell"]').first()).toBeVisible();
  await expect(page.locator(CONTENT_ISLAND)).toBeAttached();
  await expect(page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`)).toBeAttached();
});

Then('the run listing lists at least {int} run', async ({ page }, count: number) => {
  const rows = await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).count();
  expect(rows).toBeGreaterThanOrEqual(count);
});

/**
 * The run row's values, by Views field ID, in render order — the list has no
 * header, so the field set is read off the first row's `data-cell` keys.
 */
Then('the first run row carries the cells {string}', async ({ page }, keys: string) => {
  const row = page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).first();
  await expect(row).toBeVisible();
  const shown = await row.locator('[data-cell]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-cell')));
  expect(shown.join(', ')).toBe(keys);
});

Then('the first run row reads the labels {string}', async ({ page }, labels: string) => {
  const row = page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).first();
  const shown = (await row.locator('[data-cell-label]').allInnerTexts()).map((text) => text.trim());
  expect(shown.join(', ')).toBe(labels);
});

Then('no value of the run listing reads the empty-cell dash', async ({ page }) => {
  const rows = await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).count();
  expect(rows, 'The run listing did not render any rows.').toBeGreaterThan(0);
  const cells = await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] [data-cell]`).allInnerTexts();
  for (const cell of cells) {
    expect(cell.trim()).not.toBe('—');
  }
});

Then(
  'no run of the {string} project is listed',
  async ({}, _name: string) => {
    // The `bakers` workspace prefix itself refuses an account with no
    // membership of it — the same boundary `_bb_workspace_match` enforces
    // for every screen under `/_workspace/{bb_workspace}/…`. There is no
    // table to find zero rows in; the page never rendered.
    expect([403, 404]).toContain(lastStatus);
  },
);

// ---------------------------------------------------------------------------
// BB-490 — the same open/closed/all control, on the runs tab. The three
// closed-position steps (`I choose the "…" closed position`,
// `the closed control marks "…" as the current position`) are
// `support/steps/listing.steps.ts`'s own and are reused verbatim, per this file's own
// header note that the flat canvas is the same mechanism.
//
// `claim_expires_at` IS SET FAR IN THE FUTURE ON BOTH FIXTURES, never in the
// past: a fixed past timestamp is what turns into a time-dependent 403 later,
// a known footgun in this codebase (`ClaimExpireStaleClaimsTest` and friends
// terminalise a run whose lease has expired). Neither fixture's row is ever
// claimed through this suite, so the lease itself is inert — the value only
// has to avoid drifting into the past as the seeded world ages.
// ---------------------------------------------------------------------------

const OPEN_FIXTURE_RUN_TICKET_TITLE = 'BB-490 open fixture run';
const CLOSED_FIXTURE_RUN_TICKET_TITLE = 'BB-490 closed fixture run';

/**
 * The run listing's own "Ticket" column shows the TICKET'S IDENTIFIER
 * (`bakers.build-nnn`), never its title — measured against a live row, not assumed.
 * Both fixtures' identifiers are resolved from Drupal once, after creation,
 * rather than guessed from the project key and a counter, so a re-run against
 * an already-seeded world still finds the row a prior run created.
 */
let openFixtureRunIdentifier: string | null = null;
let closedFixtureRunIdentifier: string | null = null;

Given('the project has an open run and a closed run', async () => {
  const snippet = [
    '$etm = \\Drupal::entityTypeManager();',
    '$ts = $etm->getStorage("bb_ticket");',
    '$rs = $etm->getStorage("bb_run");',
    '$cs = $etm->getStorage("bb_conductor");',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["name" => "bakers-e2e-project"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    '$conductor = current($cs->loadByProperties(["conductor_id" => "bb-490-fixture-conductor"]));',
    'if (!$conductor) { $conductor = $cs->create(["conductor_id" => "bb-490-fixture-conductor", "label" => "BB-490 fixture conductor"]); $conductor->save(); }',
    '$far_future = \\Drupal::time()->getRequestTime() + 31536000;',
    `$open_ticket = current($ts->loadByProperties(["title" => "${OPEN_FIXTURE_RUN_TICKET_TITLE}"]));`,
    'if (!$open_ticket) {',
    `$open_ticket = $ts->create(["project_id" => $p->id(), "title" => "${OPEN_FIXTURE_RUN_TICKET_TITLE}", "workflow" => "bb_work", "state" => "working"]);`,
    '$open_ticket->save(); }',
    '$open_run = current($rs->loadByProperties(["ticket_id" => $open_ticket->id()]));',
    'if (!$open_run) {',
    '$open_run = $rs->create(["ticket_id" => $open_ticket->id(), "conductor_id" => $conductor->id(), "state" => "running", "state_at_start" => "working", "agent" => "opus", "started_at" => \\Drupal::time()->getRequestTime(), "claim_expires_at" => $far_future]);',
    '} else {',
    '$open_run->set("state", "running")->set("claim_expires_at", $far_future);',
    '}',
    '$open_run->save();',
    `$closed_ticket = current($ts->loadByProperties(["title" => "${CLOSED_FIXTURE_RUN_TICKET_TITLE}"]));`,
    'if (!$closed_ticket) {',
    `$closed_ticket = $ts->create(["project_id" => $p->id(), "title" => "${CLOSED_FIXTURE_RUN_TICKET_TITLE}", "workflow" => "bb_work", "state" => "working"]);`,
    '$closed_ticket->save(); }',
    '$closed_run = current($rs->loadByProperties(["ticket_id" => $closed_ticket->id()]));',
    'if (!$closed_run) {',
    '$closed_run = $rs->create(["ticket_id" => $closed_ticket->id(), "conductor_id" => $conductor->id(), "state" => "done", "state_at_start" => "working", "agent" => "opus", "started_at" => \\Drupal::time()->getRequestTime(), "duration_s" => 100, "claim_expires_at" => $far_future]);',
    '} else {',
    '$closed_run->set("state", "done")->set("duration_s", 100)->set("claim_expires_at", $far_future);',
    '}',
    // `closed` is not a self-healing projection on `bb_run` the way it is on
    // `bb_ticket` (`TicketClosure::closeIfTerminal()`): a run's own closure
    // normally rides `TicketRunClosureHooks`/`TicketClaimService` when the
    // TICKET it belongs to reaches a terminal state, not a state written
    // directly onto the run. A fixture that only sets `state: done` here
    // leaves `closed` at its default FALSE, so it is set explicitly via
    // `markClosed()`, exactly as `RunClosureFieldsTest` does.
    '$closed_run->markClosed(\\Drupal::time()->getRequestTime());',
    '$closed_run->save();',
    'print $open_ticket->get("identifier")->value . "," . $closed_ticket->get("identifier")->value;',
  ].join(' ');
  const result = php(snippet);
  const [openIdentifier, closedIdentifier] = result.split(',');
  if (!openIdentifier || !closedIdentifier) {
    throw new Error(`The open/closed run fixtures did not settle: "${result}".`);
  }
  openFixtureRunIdentifier = openIdentifier;
  closedFixtureRunIdentifier = closedIdentifier;
  // Adds this scenario's own two fixtures to the shared index and removes
  // nothing; safe alongside a concurrent worker indexing its own additions.
  Drush.exec('search-api:index bb_runs');
});

Then('I see the closed run', async ({ page }) => {
  if (closedFixtureRunIdentifier === null) {
    throw new Error('No closed run fixture was created in this scenario.');
  }
  await expect(
    page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: closedFixtureRunIdentifier }),
  ).toHaveCount(1);
});

Then('I do not see the closed run', async ({ page }) => {
  if (closedFixtureRunIdentifier === null) {
    throw new Error('No closed run fixture was created in this scenario.');
  }
  await expect(
    page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: closedFixtureRunIdentifier }),
  ).toHaveCount(0);
});

Then('I do not see the open run', async ({ page }) => {
  if (openFixtureRunIdentifier === null) {
    throw new Error('No open run fixture was created in this scenario.');
  }
  await expect(
    page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: openFixtureRunIdentifier }),
  ).toHaveCount(0);
});

Then('exactly one filter chip sits above the run listing', async ({ page }) => {
  const chips = page.locator(`${CONTENT_ISLAND} [data-facet]`);
  await expect(chips).toHaveCount(1);
  const above = await chips.first().evaluate(
    (chip, table) => Boolean(chip.compareDocumentPosition(table as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).elementHandle(),
  );
  expect(above, 'the filter chip does not sit above the run listing').toBe(true);
});

Then('the Ticket cell of the first run links to its ticket, not to the run', async ({ page }) => {
  const href = await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).first().locator('[data-cell="identifier"]').getByRole('link').getAttribute('href');
  expect(href).toContain('/ticket/');
  expect(href).not.toContain('/run/');
});
