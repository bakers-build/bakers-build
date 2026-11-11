// BB-413 — the ticket list, whose update mechanism only a browser can see.
//
// A facet pick is a boosted GET: BEF auto-submit submits the exposed form, htmx
// intercepts it because `#island-content` carries `hx-boost`, swaps the fragment
// and pushes the request URL into history. Nothing on the PHP side observes any
// of that, which is why spec `scenario_required` is TRUE for this ticket and
// why a BrowserTestBase would not be a substitute.
//
// THE SECOND PICK IS THE ASSERTION. BB-408's first delivery applied the boost
// declaration at the caller, so a swapped fragment came back bare and a boosted
// navigation worked exactly once per page load. Every navigating scenario here
// therefore picks at least twice and re-asserts after each pick.
import { Given, When, Then } from '../../bdd.fixtures';
import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { markDocument } from '../../support/shell';
import { php } from '../../support/drush';
import { active, closedControl, facetRow, facetTrigger, listing, safe } from '../../support/listing';

const { After } = createBdd(test);

/**
 * The container the list screen is scoped to.
 *
 * IT USED TO BE `island-tickets-ticket_list`, the screen's own island, and that
 * id is gone. On 2026-09-03 the human deleted `BbTicketsIslandHost` and the
 * `TicketList` plugin — the plugin's `boost()` always returned NULL, so it
 * contributed no htmx — and a plain controller composed the canvas instead. On
 * 2026-09-04 the controller went too: the tickets VIEW owns
 * `/{workspace}/tickets` again and the canvas is a `display_builder` sources
 * tree on its page display. Neither move touches this constant. The scope moves
 * UP to the shell's content island rather than being dropped, because that is
 * the node this screen's boost actually belongs to: `#island-content` is what
 * carries `hx-boost` and what a facet pick swaps. Scoping to it therefore keeps
 * every assertion below a claim about the swappable fragment rather than about
 * the document at large.
 */
import { CONTENT_ISLAND, RAIL_ISLAND } from '../../support/shell';

/** The window symbol whose survival answers "was the document kept?". */
const MARK = '__bakers413_mark';


/**
 * The table's row count captured when the ticket list was last visited —
 * baseline for "fewer tickets than before" and "as many tickets as before".
 */
let baselineRowCount: number | null = null;

/**
 * Client-side facts of every option row in the panel that the last pointer
 * click landed on, captured in the same turn as the click — before BEF's
 * swap replaces the fragment. Keyed by the row's visible label.
 */
type FacetRowFacts = {
  type: string | null;
  checked: boolean;
  aria: string | null;
  svgVisibility: string;
  borderWidth: string;
};
let lastPanelFacts: Record<string, FacetRowFacts> | null = null;


/**
 * The identifier of BB-492's second-workspace ticket, once seeded.
 *
 * Read by `the second workspace's ticket is {listed,not listed}`, so the
 * scenario asserts on the exact identifier the fixture created rather than on
 * a title string duplicated between the step and the fixture.
 */
let secondWorkspaceTicketIdentifier: string | null = null;

/** The slug of BB-492's second-workspace fixture, for the `After` teardown. */
let secondWorkspaceSlug: string | null = null;






/**
 * Stamps the window so a full page load can be detected.
 *
 * A boosted navigation replaces a fragment and keeps the document; a full load
 * discards it. There is no Playwright API for "is this the same document", and
 * comparing URLs, HTML or navigation events reports the same thing for both
 * cases — a reload would satisfy every one of them. Only a symbol the document
 * carries can tell them apart.
 */
async function mark(page: Page): Promise<void> {
  await page.evaluate((key) => {
    (window as unknown as Record<string, unknown>)[key] = 'kept';
  }, MARK);
}

async function kept(page: Page): Promise<boolean> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key] === 'kept',
    MARK,
  );
}

/**
 * The public path of a workspace's ticket list.
 *
 * The workspace is resolved through Drupal rather than hardcoded, so the
 * scenario keeps working when the seed is regenerated — but the PATH is built
 * from the slug rather than from `Url::fromRoute()`. Measured: in a CLI context
 * that route renders `/1/tickets`, because `BbWorkspacePathProcessor` needs a
 * request to map the entity id back to its slug. The slug IS the public
 * segment, and asking Drupal for it is what makes a missing workspace fail
 * loudly here instead of as a 404 three steps later.
 */
function ticketListPath(slug: string): string {
  const resolved = php(
    '$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")' +
      `->loadByProperties(["slug" => "${safe(slug)}"])); print $w ? $w->get("slug")->value : "";`,
  );
  if (!resolved) {
    throw new Error(`No bb_workspace with slug "${slug}" exists in the seeded world.`);
  }
  return `/${resolved}/tickets`;
}

/**
 * The public path of a workspace's FULL find-a-ticket listing.
 *
 * TWO PATHS BECAUSE THERE ARE TWO DISPLAYS SINCE 2026-09-04. The human decided
 * that a filtered variant of the ticket list is a Views DISPLAY with real
 * filters, not the same display reached with facet defaults chosen for the
 * reader — so `my_work` took `/{workspace}/tickets`, the nav home, narrowed to
 * the reader's own non-terminal tickets, and the full table moved to
 * `/{workspace}/tickets/all`.
 *
 * MOST OF THIS FILE'S SCENARIOS MOVED WITH IT, deliberately. Their subject is
 * the FACET TRANSPORT — pick, boost, swap, push, chip, remove — over a table
 * with rows in it, and on the scoped list the values a scenario picks depend on
 * which tickets happen to be assigned to whichever member the seed produced.
 * That is a different claim and a fragile one. The two scenarios that stay on
 * `/{workspace}/tickets` are the ones whose subject really is that screen: the
 * document detector's negative control, and the no-JavaScript disclosure.
 */
function fullTicketListPath(slug: string): string {
  return `${ticketListPath(slug)}/all`;
}

/**
 * The public path of a project's own tickets tab (`project_tickets`).
 *
 * Resolved through Drupal's own `toUrl()`, like `run-list.steps.ts`'s
 * `projectRunsUrl()` — the pattern `project_tickets`/`team_tickets` already
 * exercise for runs — rather than built from the project's key, so a rename
 * of the entity's canonical route does not silently stop finding it.
 */
function projectTicketsPath(name: string): string {
  const url = php(
    '$e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $e ? $e->toUrl()->toString() : "";`,
  );
  if (!url) {
    throw new Error(`No bb_project named "${name}" exists in the seeded world.`);
  }
  return `${url}/tickets`;
}

/**
 * The public path of a team's own tickets tab (`team_tickets`).
 *
 * The `team_tickets` counterpart of `projectTicketsPath()` above, resolved
 * the same way `run-list.steps.ts`'s `teamRunsUrl()` resolves the runs tab —
 * through the entity's own `toUrl()`, never built from a slug.
 */
function teamTicketsPath(name: string): string {
  const url = php(
    '$e = current(\\Drupal::entityTypeManager()->getStorage("bb_team")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $e ? $e->toUrl()->toString() : "";`,
  );
  if (!url) {
    throw new Error(`No bb_team named "${name}" exists in the seeded world.`);
  }
  return `${url}/tickets`;
}

// THE INDEXING PREREQUISITE, stated in the feature and done here.
//
// T11 measured `indexed before: 0 of 15` on a fresh
// `ddev init --provider recipe-test`: the recipe seeds content and nothing
// indexes it, `index_directly` was off and the cron batch is 50, so every facet
// offered nothing and every table was empty. T11b set `index_directly: true`,
// and a fresh world now reports 15 of 15 with no help — so this step normally
// finds nothing to do and prints "is up to date". It stays because the suite
// must not depend on the order in which a provisioner creates the index and the
// content, and because a scenario that only passes after somebody indexed by
// hand is a scenario that fails in CI.
//
// It also clears the page override, so the no-JavaScript context and the shared
// tab cannot outlive their own scenario.
Given('the ticket index is up to date', async () => {
  listing.page = null;
  lastPanelFacts = null;
  listing.uid = null;
  listing.slug = null;
  secondWorkspaceTicketIdentifier = null;
  // Adds pending items to the shared index and removes nothing; this scenario's
  // assertions are scoped to its own workspace/project, so a concurrent worker
  // indexing its own additions changes nothing this scenario reads.
  Drush.exec('search-api:index bb_tickets');
});


/**
 * Deletes a previous run's second-workspace fixture, if one is still there.
 *
 * The fixture is tagged `@bb-492-second-workspace` and torn down by the
 * matching `After` hook below, but a run that crashed before that hook fired
 * — or was interrupted — can leave it behind, and a leftover workspace with
 * the same slug makes the next creation fail on a unique-slug conflict rather
 * than on anything this ticket is about. Deleting the OWNER first is what
 * frees the workspace's slug for a plain `create()` to reuse; deleting the
 * workspace alone would leave an orphaned owner that then collides on name.
 */
function removeSecondWorkspaceFixture(slug: string): void {
  const s = safe(slug);
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$workspace = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${s}"]));`,
      'if ($workspace) {',
      '$group = $etm->getStorage("bb_group")->loadByProperties(["workspace_id" => $workspace->id()]);',
      'foreach ($group as $g) {',
      'foreach ($etm->getStorage("bb_project")->loadByProperties(["group_id" => $g->id()]) as $p) {',
      'foreach ($etm->getStorage("bb_ticket")->loadByProperties(["project_id" => $p->id()]) as $t) { $t->delete(); }',
      '$p->delete(); }',
      '$g->delete(); }',
      'foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $workspace->id()]) as $team) { $team->delete(); }',
      '$owner_id = $workspace->get("owner_user_id")->target_id;',
      '$workspace->delete();',
      'if ($owner_id) { $etm->getStorage("user")->load($owner_id)?->delete(); } }',
    ].join(' '),
  );
}

/**
 * Builds the second workspace BB-492's fix needs — the recipe seeds the
 * signed-in reader into exactly one, and the defect this ticket fixes is
 * invisible with only one.
 *
 * Mirrors `TicketMyWorkWorkspaceScopeTest::seedTwoWorkspaces()` (Kernel): a
 * workspace, group, team and project, one open ticket assigned to the
 * ALREADY-signed-in reader, membership in both the workspace and the team
 * (BB-462 D4/D7 routes project visibility through team membership), and a
 * reindex so the ticket is actually findable.
 *
 * TORN DOWN BY THE MATCHING `After` HOOK, not left standing: the fixture's
 * second-workspace ticket is assigned to the SAME reader every other
 * `ticket-list` scenario signs in as, and `the ticket listing lists exactly my
 * open tickets` compares against that reader's assigned tickets ACROSS EVERY
 * WORKSPACE — a leftover fixture would inflate that expectation while the
 * fixed, workspace-scoped screen rightly keeps showing less.
 */
Given(
  'I have an open ticket assigned to me in the second workspace {string}',
  async ({}, slug: string) => {
    if (listing.uid === null) {
      throw new Error('No account is signed in to assign the second-workspace ticket to.');
    }
    const s = safe(slug);
    removeSecondWorkspaceFixture(s);
    const identifier = php(
      [
        '$etm = \\Drupal::entityTypeManager();',
        '$reader = \\Drupal\\user\\Entity\\User::load(' + listing.uid + ');',
        // A throwaway owner, distinct from the reader — BB-492's own Kernel
        // fixture uses the same split, because
        // `og.settings.auto_add_group_owner_membership` makes every owner a
        // member on save, and an owning reader would hold a membership this
        // step never wrote.
        '$owner = $etm->getStorage("user")->create(["name" => "bb-492-owner-' + s + '", "status" => 1]);',
        '$owner->save();',
        `$workspace = $etm->getStorage("bb_workspace")->create(["name" => "BB-492 beta", "slug" => "${s}", "owner_user_id" => $owner->id()]);`,
        '$workspace->save();',
        `$group = $etm->getStorage("bb_group")->create(["name" => "BB-492 beta group", "workspace_id" => $workspace->id(), "owner_user_id" => $owner->id()]);`,
        '$group->save();',
        `$team = $etm->getStorage("bb_team")->create(["name" => "BB-492 beta team", "workspace_id" => $workspace->id(), "owner_user_id" => $owner->id()]);`,
        '$team->save();',
        `$project = $etm->getStorage("bb_project")->create(["name" => "BB-492 beta project", "key" => "G492B", "group_id" => $group->id(), "teams" => [$team->id()], "owner_user_id" => $owner->id()]);`,
        '$project->save();',
        `$ticket = $etm->getStorage("bb_ticket")->create(["title" => "BB-492 second-workspace ticket", "state" => "working", "workflow" => "bb_work", "priority" => 2, "project_id" => $project->id(), "assignee_user_id" => ${listing.uid}, "owner_user_id" => $owner->id()]);`,
        '$ticket->save();',
        // `contributor`, not `member`: BB-462 D1 made the bare `member`
        // rank grant nothing, including `view bb_ticket` — measured against
        // this very fixture, which 403'd on the entity read until the role
        // changed.
        '\\Drupal\\og\\Og::createMembership($workspace, $reader)' +
          '->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-contributor")])->save();',
        '\\Drupal\\og\\Og::createMembership($team, $reader)->save();',
        '\\Drupal::service("cache.static")->deleteAll();',
        'print $ticket->get("identifier")->value;',
      ].join(' '),
    );
    if (!identifier) {
      throw new Error('The second-workspace fixture ticket was not created.');
    }
    secondWorkspaceTicketIdentifier = identifier;
    secondWorkspaceSlug = s;
    // Adds this scenario's own fixture; removes nothing shared, so a
    // concurrent worker's own index run is unaffected.
    Drush.exec('search-api:index bb_tickets');
  },
);

/**
 * Removes the second-workspace fixture once its scenario is done.
 *
 * Scoped to `@bb-492-second-workspace` so no other scenario in this suite
 * pays for it, and it runs whether the scenario passed or failed — a fixture
 * left behind by a failing run is exactly the leftover that broke a later
 * run's unique-slug create and, worse, silently inflated another scenario's
 * cross-workspace ticket count.
 */
After({ tags: '@bb-492-second-workspace' }, async () => {
  if (secondWorkspaceSlug === null) {
    return;
  }
  removeSecondWorkspaceFixture(secondWorkspaceSlug);
  // Reflects the removal of THIS scenario's own fixture only; no other
  // scenario's ticket is touched by this index run.
  Drush.exec('search-api:index bb_tickets');
  secondWorkspaceSlug = null;
  secondWorkspaceTicketIdentifier = null;
});

Then("the second workspace's ticket is not listed", async ({ page }) => {
  if (secondWorkspaceTicketIdentifier === null) {
    throw new Error('No second-workspace ticket was seeded to assert against.');
  }
  const body = await active(page).locator('body').innerText();
  expect(
    body,
    `${secondWorkspaceTicketIdentifier} is on a screen it must not reach.`,
  ).not.toContain(secondWorkspaceTicketIdentifier);
});

Then("the second workspace's ticket is listed", async ({ page }) => {
  if (secondWorkspaceTicketIdentifier === null) {
    throw new Error('No second-workspace ticket was seeded to assert against.');
  }
  const body = await active(page).locator('body').innerText();
  expect(
    body,
    `${secondWorkspaceTicketIdentifier} is missing from the workspace it belongs to.`,
  ).toContain(secondWorkspaceTicketIdentifier);
});

/**
 * Builds a page with JavaScript switched off, carrying the current session.
 *
 * A context's `javaScriptEnabled` cannot be changed after it is created, so the
 * no-JavaScript scenario needs a context of its own — and it needs the session,
 * which is why the storage state is copied across rather than logging in again.
 */
Given('JavaScript is disabled', async ({ page }) => {
  const browser = page.context().browser();
  if (browser === null) {
    throw new Error('No browser to open a JavaScript-less context in.');
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    storageState: await page.context().storageState(),
  });
  listing.page = await context.newPage();
});

When(
  'I visit the ticket list of the {string} workspace',
  async ({ page }, slug: string) => {
    const target = active(page);
    const response = await target.goto(ticketListPath(slug));
    expect(response?.status() ?? 0, `The ticket list of "${slug}" did not render`).toBeLessThan(400);
    // Only a page that runs scripts can carry a mark, and only such a page is
    // ever asked whether it kept its document.
    if (listing.page === null) {
      await mark(target);
    }
  },
);

When(
  'I visit the full ticket list of the {string} workspace',
  async ({ page }, slug: string) => {
    const target = active(page);
    const response = await target.goto(fullTicketListPath(slug));
    expect(response?.status() ?? 0, `The full ticket list of "${slug}" did not render`)
      .toBeLessThan(400);
    if (listing.page === null) {
      await mark(target);
    }
    baselineRowCount = await listRowCount(target);
    lastPanelFacts = null;
  },
);

/**
 * BB-490's regression coverage that the closed control is not inert on
 * `project_tickets` — the two-displays bug the final review of this branch
 * found: `project_tickets` and `team_tickets` render the control (Task 5
 * placed the source in their canvas) but never inherited `bb_closed_rows`
 * from `default` (Task 6 only extended `my_work`).
 */
When('I visit the tickets tab of project {string}', async ({ page }, name: string) => {
  const target = active(page);
  const response = await target.goto(projectTicketsPath(name));
  expect(response?.status() ?? 0, `The tickets tab of project "${name}" did not render`)
    .toBeLessThan(400);
  if (listing.page === null) {
    await mark(target);
  }
});

/**
 * `team_tickets`' own counterpart of the scenario above — carried over from
 * the final review verdict, which found it was the only one of the six
 * ticket/run listings with no runtime coverage at all, despite sharing its
 * filter configuration with `project_tickets`.
 */
When('I visit the tickets tab of team {string}', async ({ page }, name: string) => {
  const target = active(page);
  const response = await target.goto(teamTicketsPath(name));
  expect(response?.status() ?? 0, `The tickets tab of team "${name}" did not render`)
    .toBeLessThan(400);
  if (listing.page === null) {
    await mark(target);
  }
});

/**
 * The unqualified visit every BB-420 Task 6 scenario opens with.
 *
 * Fixed to the "bakers" workspace — the same one `ticket-create.steps.ts`'s own
 * `bakersWorkspacePath()` resolves — because that scenario asserts the header's
 * OWN add action rather than tenancy, so which workspace it runs against is
 * incidental and does not need to be a parameter of the step text.
 *
 * IT IS THE FULL TABLE, `/{workspace}/tickets/all`, since the ticket list
 * became two displays. `my_work` took the nav home and narrows to the reader's
 * own non-terminal tickets; the add action is composed into `page_1`'s canvas
 * header, and a ticket this suite files — assigned to whichever conductor the
 * scenario picked, or to nobody — belongs to the find-a-ticket listing rather
 * than to the reader's own work. `the ticket list shows …` is asserted on the
 * screen the dialog's `HX-Location` returns to, which is this one.
 *
 * Marked through `markDocument()` (`support/steps/shell.steps.ts`) rather than
 * through this file's own `mark()`/`kept()` pair: `the document was not
 * reloaded` is that detector's step text, and importing it rather than
 * re-deriving it is what keeps the phrase meaning one thing across the whole
 * suite.
 */
When('I visit the ticket list', async ({ page }) => {
  const response = await page.goto(fullTicketListPath('bakers'));
  expect(response?.status() ?? 0, 'The ticket list did not render').toBeLessThan(400);
  await markDocument(page);
});

/**
 * Clicks a named action in the ticket list's own content header
 * (`bb_theme:page_header`'s `actions` slot — BB-420 Task 6).
 *
 * FOUND BY ACCESSIBLE NAME, not by a class or a data attribute of its own:
 * the trigger is icon-only, so `button.twig` moves its `label` prop into
 * `aria-label`, and that is the same name an operator using a screen reader
 * would reach it by.
 *
 * The wait is on the CLICK'S OWN RESPONSE rather than on the address. The
 * scenario this step serves clicks the action TWICE, and the address the click
 * writes is the same both times — a wait keyed on a string being present would
 * resolve before the second click's own round trip ever happened, proving
 * nothing about it. Waiting for the next matching response is the same idiom
 * `steps/team/team-islands.steps.ts`'s `I add the member` step uses for the equivalent
 * problem.
 *
 * MATCHED ON THE WRAPPER FORMAT since BB-420 Task 24. The click used to be a
 * boosted navigation to the current screen plus `?create=ticket`; it is now a
 * fetch of the dialog's own route through `_wrapper_format=island_dialog`,
 * which is the string that says "this response is the dialog" — and says it
 * without naming a path, so the step does not have to know which route the
 * dialog lives at. THE NAME CHANGED IN BB-420 TASK 36: `bb_core` used to
 * register a second format of its own (`bb_dialog`) against the same
 * mechanism; it is deleted now that `bb_theme:dialog` declares
 * `replaces: island:dialog`, so the request the trigger makes carries
 * `island`'s own registered name instead.
 */
When('I click the {string} action', async ({ page }, label: string) => {
  const target = active(page);
  const answered = target.waitForResponse(
    (response) => response.request().method() === 'GET'
      && response.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await target.getByRole('link', { name: label, exact: true }).click();
  await answered;
});

/**
 * Types into a searchable facet's filter box, opening the panel first.
 */
async function typeInFacetSearch(page: Page, query: string, facet: string): Promise<void> {
  const target = active(page);
  await target.waitForFunction(
    () => !document.querySelector('.htmx-request'),
    null,
    { timeout: 20000 },
  );
  const trigger = facetTrigger(target, facet);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  const panelId = await trigger.getAttribute('aria-controls');
  const search = target.locator(`#${panelId} [data-option-picker-search]`);
  await search.waitFor({ state: 'visible' });
  await search.fill(query);
}

When(
  'I type {string} in the {string} facet search',
  async ({ page }, query: string, facet: string) => typeInFacetSearch(page, query, facet),
);

When(
  'I type the key of {string} in the {string} facet search',
  async ({ page }, title: string, facet: string) => typeInFacetSearch(page, familyKey(title), facet),
);

/**
 * Picks one facet value the way everyone else does: with the mouse.
 *
 * THIS STEP EXISTS BECAUSE THE KEYBOARD ONE CANNOT SEE R8. Focus and Space reach
 * the row's `<input>` through the accessibility tree, which does not care what
 * paints on top of what. A pointer does. the canvas' `[data-canvas-region="filters"]` region is
 * `position: sticky`, and a sticky element creates a stacking context whatever
 * its `z-index`, so the panel's `z-index: 30` could not escape it and the
 * table's positioned `<td class="relative">` — later in the document — painted
 * over the rows. That is the defect this step was written RED against and the
 * fix it now guards.
 *
 * `elementFromPoint` IS READ BEFORE THE CLICK, and that is the difference
 * between a useful gate and a useless one. A click that picks nothing reports
 * only "nothing was picked"; the hit test names the element that is in the way,
 * which is the whole diagnosis. Playwright's own hit-target check would refuse
 * the click instead, so the coordinates are clicked RAW through `mouse.click()`
 * — the browser's own dispatch, with no library between it and the defect.
 */
When(
  'I click {string} in the {string} facet with a pointer',
  async ({ page }, label: string, facet: string) => {
    const target = active(page);
    // A previous pick's boosted GET may still be in flight. Settle it
    // first so this click lands on a live panel, not a fragment about
    // to be replaced.
    await target.waitForFunction(
      () => !document.querySelector('.htmx-request'),
      null,
      { timeout: 20000 },
    );
    const row = await facetRow(page, facet, label);
    const trigger = facetTrigger(target, facet);
    const panelId = await trigger.getAttribute('aria-controls');

    const box = await row.boundingBox();
    expect(box, `The "${label}" row of the "${facet}" facet has no box.`).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    const hit = await target.evaluate(
      ([px, py, pid]) => {
        const element = document.elementFromPoint(Number(px), Number(py));
        const panel = document.getElementById(String(pid));
        return {
          what: element
            ? `${element.tagName}.${(element.getAttribute('class') ?? '').split(/\s+/)[0]}`
            : 'nothing',
          inPanel: element !== null && panel !== null && panel.contains(element),
        };
      },
      [String(x), String(y), String(panelId)],
    );
    expect(
      hit.inPanel,
      `A pointer at the centre of the "${label}" row of the "${facet}" facet ` +
        `hits ${hit.what}, which is not inside the panel — the panel is painted over.`,
    ).toBe(true);

    // Snapshot the OPEN panel from the same element the click landed on,
    // then settle the boosted GET before returning. The snapshot is the
    // pre-swap client state the next Then reads; the wait is what lets
    // "the document survived" observe the document after the swap, not
    // microseconds after dispatch. Address-changed, not a specific
    // parameter: un-picking removes a value rather than adding one.
    const before = await target.evaluate(
      () => window.location.pathname + window.location.search,
    );
    const panelHandle = await target.locator(`#${panelId}`).elementHandle();
    await target.mouse.click(x, y);
    lastPanelFacts = panelHandle
      ? await panelHandle.evaluate((panel) => {
          if (!document.contains(panel)) {
            throw new Error('the panel was swapped first');
          }
          const out: Record<string, FacetRowFacts> = {};
          panel.querySelectorAll('li[data-value]').forEach((row) => {
            const name = (row.querySelector('.option-list__label')?.textContent || '').trim();
            const input = row.querySelector('input');
            const marker = row.querySelector('.option-list__marker');
            const svg = marker ? marker.querySelector('svg') : null;
            out[name] = {
              type: input ? input.getAttribute('type') : null,
              checked: input ? input.checked : false,
              aria: row.getAttribute('aria-selected'),
              svgVisibility: svg ? getComputedStyle(svg).visibility : 'missing',
              borderWidth: marker ? getComputedStyle(marker).borderTopWidth : '',
            };
          });
          return out;
        })
      : null;
    await target.waitForFunction(
      (previous) => window.location.pathname + window.location.search !== previous,
      before,
      { timeout: 20000 },
    );
    await target.waitForFunction(
      () => !document.querySelector('.htmx-request'),
      null,
      { timeout: 20000 },
    );
  },
);

Then('the document survived', async ({ page }) => {
  expect(await kept(active(page))).toBe(true);
});

// The detector's failing side. Without this every "survived" assertion above
// rests on a mechanism that has never been seen to report anything else.
Then('the document did not survive', async ({ page }) => {
  expect(await kept(active(page))).toBe(false);
});

Then('the ticket listing is rendered inside the bakers.build shell', async ({ page }) => {
  const target = active(page);
  await expect(target.locator('[data-component-id="bb_theme:shell"]').first()).toBeVisible();
  await expect(target.locator(CONTENT_ISLAND)).toBeAttached();
  await expect(target.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`)).toBeAttached();
});

/**
 * ROWS ARE COUNTED ON `.table__row`, the class `bb_theme:table` puts on
 * every `<tr>` it renders. This used to count `[data-row-url]`, an attribute
 * BB-413 deleted after measuring that nothing read it — no JavaScript, no
 * CSS, only the tests that asserted it. The class is the better counter
 * regardless: the attribute was conditional on the row entity answering a
 * target, so a table full of rows with no target counted as zero rows.
 */
async function listRowCount(target: Page): Promise<number> {
  return target.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).count();
}

Then('the ticket listing lists at least {int} ticket', async ({ page }, count: number) => {
  const rows = await listRowCount(active(page));
  expect(rows).toBeGreaterThanOrEqual(count);
});

/**
 * The narrowing half of the checkbox-facet regression. The baseline is
 * captured when the ticket list was last visited (`I visit the full ticket
 * list …`), so this reads only as a comparison against that visit — never as
 * an absolute count, which the seed does not promise. Polled because the
 * pointer click that precedes it does not wait for the boosted swap.
 */
Then('the ticket listing lists fewer tickets than before', async ({ page }) => {
  expect(baselineRowCount, 'No baseline row count was captured — visit the ticket list first.').not.toBeNull();
  await expect(async () => {
    const n = await listRowCount(active(page));
    expect(n, 'the ticket listing is empty').toBeGreaterThan(0);
    expect(n).toBeLessThan(baselineRowCount as number);
  }).toPass({ timeout: 20000 });
});

/**
 * The restore half of clearing a facet through its Any row. The baseline is
 * the unfiltered visit; after the clear request lands the listing must be
 * that wide again. Polled because the pointer click waits only for the
 * address, not for the swapped rows.
 */
Then('the ticket listing lists as many tickets as before', async ({ page }) => {
  expect(baselineRowCount, 'No baseline row count was captured — visit the ticket list first.').not.toBeNull();
  await expect(async () => {
    const n = await listRowCount(active(page));
    expect(n).toBe(baselineRowCount as number);
  }).toPass({ timeout: 20000 });
});

/**
 * The three facts a checkbox row states about its own selection, read
 * TOGETHER and immediately after the click. The defect this guards was
 * exactly their disagreement — `input.checked` true while `aria-selected`
 * stayed false and the marker drew no glyph — so a step that checked only
 * one of them, or that waited for the BEF swap and then read the
 * server-rendered fragment, would still pass on the broken code. One click
 * on a checkbox row must leave input, `aria-selected` and marker agreeing.
 *
 * The marker paints no box in either state: unchecked shows nothing,
 * checked shows only the glyph. The width is read, not the colour, because a
 * zero-width border can still compute a non-transparent colour.
 */
/**
 * One synchronous snapshot of the row that is currently in the open panel.
 * Playwright auto-waiting on `toBeVisible()` would retry across the BEF
 * swap and then read the replacement fragment — the server-rendered state
 * the defect never lived in.
 */
async function snapshotFacetRow(page: Page, facet: string, label: string) {
  const row = await facetRow(page, facet, label);
  return row.evaluate((el) => {
    const input = el.querySelector('input');
    const marker = el.querySelector('.option-list__marker');
    const svg = marker ? marker.querySelector('svg') : null;
    return {
      type: input ? input.getAttribute('type') : null,
      checked: input ? input.checked : false,
      aria: el.getAttribute('aria-selected'),
      svgVisibility: svg ? getComputedStyle(svg).visibility : 'missing',
      borderWidth: marker ? getComputedStyle(marker).borderTopWidth : '',
    };
  });
}

Then(
  'the {string} row of the {string} facet reads as checked',
  async ({ page }, label: string, facet: string) => {
    const facts = lastPanelFacts?.[label] ?? (await snapshotFacetRow(page, facet, label));
    expect(facts.checked, `${label} input.checked`).toBe(true);
    expect(facts.aria, `${label} aria-selected`).toBe('true');
    expect(facts.svgVisibility, `${label} marker glyph`).toBe('visible');
    expect(facts.borderWidth, `${label} marker has no empty box`).toBe('0px');
  },
);

Then(
  'the {string} row of the {string} facet reads as unchecked',
  async ({ page }, label: string, facet: string) => {
    const facts = lastPanelFacts?.[label] ?? (await snapshotFacetRow(page, facet, label));
    expect(facts.checked, `${label} input.checked`).toBe(false);
    expect(facts.aria, `${label} aria-selected`).toBe('false');
    expect(facts.svgVisibility, `${label} marker glyph`).toBe('hidden');
    expect(facts.borderWidth, `${label} marker has no empty box`).toBe('0px');
  },
);

/**
 * The summary sentence above the rows, as one line.
 *
 * Asserted as a SENTENCE rather than as props, because two thirds of the
 * wording is the component's: `active-filters.twig` derives `is` from one value
 * and `is either of` from several. A props assertion would check the half where
 * the wording does not live.
 */
/*
 * `no active filters are stated` IS DELETED, AND ITS TWO USES ARE BACK TO
 * ASSERTING THE STATEMENT.
 *
 * It existed for one day. On 2026-09-04 the human took `views_filters_summary`
 * over bakers's own summary code, and that module renders no summary when no
 * filter has a value — `buildFilterSummary()` returns `[]`, so the theme hook
 * this theme overrides is never invoked and `active-filters`' `empty_label`
 * could not be reached from inside it. The step stated that measurement in
 * place of `the active filters read "All tickets"`.
 *
 * `active-filters` now carries a `chips` slot and a `chips_only` variant, and
 * each display's `display_builder` tree wraps `view_header` in an outer node
 * that fills the slot: a slot that renders nothing is the signal the module
 * cannot send, so the outer node states the word. The two assertions are
 * therefore back to reading it, and the step that stated its absence is gone
 * rather than left standing over nothing.
 */

Then('the active filters read {string}', async ({ page }, text: string) => {
  const strip = active(page)
    .locator('[data-component-id="bb_theme:active-filters"]')
    .first();
  await expect(strip).toBeAttached();
  const actual = (await strip.innerText()).replace(/\s+/g, ' ').trim();
  expect(actual, `The chips read "${actual}"`).toContain(text);
});

Then('the filter panel is open', async ({ page }) => {
  await expect(
    active(page).locator('aside[data-component-id="bb_theme:filters"] details'),
  ).toHaveAttribute('open', '');
});

Then('the filter panel is collapsed', async ({ page }) => {
  await expect(
    active(page).locator('aside[data-component-id="bb_theme:filters"] details'),
  ).not.toHaveAttribute('open', '');
});

// The native `<summary>`, clicked with JavaScript off. No behaviour and no CSS
// class is involved: `<details>` collapses because the browser collapses it.
When('I click the {string} heading', async ({ page }, heading: string) => {
  await active(page)
    .locator('aside[data-component-id="bb_theme:filters"] details summary')
    .filter({ hasText: heading })
    .click();
});

/**
 * PHP fragment resolving the ids of every project in one workspace, assigned
 * to `$projectIds`.
 *
 * `my_work` is scoped to the ACTIVE WORKSPACE (BB-492), not to the whole
 * site, so a PHP snapshot compared against it has to apply the same scope.
 * Without it, a concurrent worker's ticket in a workspace `listing.uid`
 * happens to also read/write in — a different feature file, a different
 * project — moves a site-wide count the screen itself never shows.
 */
function projectIdsInWorkspaceSnippet(slug: string): string {
  const s = safe(slug);
  return [
    '$projectIds = [];',
    `$ws = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${s}"]));`,
    'if ($ws) {',
    'foreach (\\Drupal::entityTypeManager()->getStorage("bb_group")->loadByProperties(["workspace_id" => $ws->id()]) as $g) {',
    'foreach (\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["group_id" => $g->id()]) as $p) {',
    '$projectIds[] = (string) $p->id(); } } }',
  ].join(' ');
}

/**
 * The scoped list holds EXACTLY the reader's own non-terminal tickets.
 *
 * BOTH SIDES ARE DERIVED FROM DRUPAL, not typed here. The account is whichever
 * member the seed produced — `listing.uid`, resolved by the `Given` step — and
 * the terminal states come from `TypeWorkflows::terminalTicketStates()`, which
 * is the same source `bb_non_terminal_ticket_state` reads. A scenario that
 * listed `done, cancelled` would be the config restatement this display exists
 * to avoid, one layer up.
 *
 * IT IS A SET COMPARISON AND NOT A COUNT. A count passes on a screen showing
 * somebody else's three tickets, which is precisely the defect the assignee
 * filter can have. The set is compared against the rendered IDENTIFIERS, the
 * first cell of every row.
 *
 * THE EXPECTED SET IS ASSERTED NON-EMPTY FIRST, because "the reader has no open
 * work" would satisfy every other claim here on a completely broken screen.
 */
Then('the ticket listing lists exactly my open tickets', async ({ page }) => {
  if (listing.uid === null || listing.slug === null) {
    throw new Error('No account was signed in, so there is no work to scope to.');
  }
  const expected = php(
    [
      projectIdsInWorkspaceSnippet(listing.slug),
      '$terminal = [];',
      'foreach (\\Drupal\\bb_core\\Workflow\\TypeWorkflows::terminalTicketStates() as $w => $states) {',
      '$terminal[$w] = $states; }',
      '$out = [];',
      'foreach (\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadMultiple() as $t) {',
      `if ((string) ($t->get("assignee_user_id")->target_id ?? "") !== "${listing.uid}") { continue; }`,
      'if (!in_array((string) ($t->get("project_id")->target_id ?? ""), $projectIds, TRUE)) { continue; }',
      '$w = (string) $t->get("workflow")->value;',
      '$s = (string) $t->get("state")->value;',
      'if (in_array($s, $terminal[$w] ?? [], TRUE)) { continue; }',
      '$out[] = (string) $t->get("identifier")->value; }',
      'sort($out);',
      'print implode(",", $out);',
    ].join(' '),
  )
    .split(',')
    .filter((identifier) => identifier !== '');

  expect(expected.length, 'The signed-in member has no open work to show.').toBeGreaterThan(0);

  const shown = (
    await active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item] [data-cell="identifier"]`).allInnerTexts()
  )
    .map((text) => text.trim())
    .sort();

  expect(shown).toEqual(expected);
});

/**
 * The full table lists MORE than the scoped one did.
 *
 * The scoped assertion above would also pass on a display whose filters are
 * doing nothing, if the seed happened to give every ticket to one member. This
 * is what makes the narrowing observable: the same reader, one segment along,
 * sees strictly more.
 */
Then('the ticket listing lists more than my open tickets', async ({ page }) => {
  if (listing.uid === null || listing.slug === null) {
    throw new Error('No account was signed in, so there is no work to compare against.');
  }
  const mine = php(
    [
      projectIdsInWorkspaceSnippet(listing.slug),
      // The full listing's default segmented-control position is "Open"
      // (BB-490), so it excludes terminal tickets the same way `my_work`
      // does. Counting a closed ticket here made `mine` bigger than a page
      // that never shows it — not a race, a filter this count had dropped.
      '$terminal = [];',
      'foreach (\\Drupal\\bb_core\\Workflow\\TypeWorkflows::terminalTicketStates() as $w => $states) {',
      '$terminal[$w] = $states; }',
      '$n = 0;',
      'foreach (\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadMultiple() as $t) {',
      `if ((string) ($t->get("assignee_user_id")->target_id ?? "") !== "${listing.uid}") { continue; }`,
      'if (!in_array((string) ($t->get("project_id")->target_id ?? ""), $projectIds, TRUE)) { continue; }',
      '$w = (string) $t->get("workflow")->value;',
      '$s = (string) $t->get("state")->value;',
      'if (in_array($s, $terminal[$w] ?? [], TRUE)) { continue; }',
      '$n++; }',
      'print $n;',
    ].join(' '),
  );
  const rows = await active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`).count();

  expect(rows, `The reader owns ${mine} tickets and the full listing shows ${rows}`)
    .toBeGreaterThan(Number(mine));
});

Then('the ticket list screen is rendered', async ({ page }) => {
  const target = active(page);
  await expect(target.locator('[data-component-id="bb_theme:shell"]').first()).toBeVisible();
  await expect(target.locator(CONTENT_ISLAND)).toBeAttached();
  // An empty result set renders NO table at all, so the screen is proved by the
  // parts that are there whatever the query answered. Without this the next
  // step's "nothing is listed" would also be true of a page that failed to
  // render.
  //
  // IT USED TO ASSERT THE SUMMARY STRIP TOO, and that half went on 2026-09-04:
  // this scenario visits an UNFILTERED list, and `views_filters_summary`
  // renders no summary when no filter has a value, so the strip is legitimately
  // absent. The aside is the right witness anyway — it renders from the view's
  // exposed form whatever the query answered, where the strip never did.
  await expect(target.locator('aside[data-component-id="bb_theme:filters"]')).toBeAttached();
  await expect(
    target.locator('aside[data-component-id="bb_theme:filters"] details'),
  ).toBeAttached();
});

/**
 * Asserts the absence of every ticket of another workspace.
 *
 * The assertion is on what this account CANNOT see, which is the side AC 8's
 * defect fails on. The identifiers say that none of THESE tickets — the
 * denied workspace's own — appear anywhere on the page.
 *
 * THE ROW COUNT IS NOT ASSERTED AS A HARD ZERO. It used to be, on the
 * assumption that the READER's own workspace was itself ticket-less in this
 * fixture world — BB-462's own ticket-detail.steps.ts fixture ("the other
 * workspace has a project, a ticket and a member") gives that assumption up:
 * `south-contributor` now legitimately sees exactly one ticket of ITS OWN
 * workspace once that fixture has run, and asserting a hard 0 turned that
 * correct visibility into a false failure the moment both fixtures shared a
 * suite run. The row count is compared instead against how many tickets the
 * READER's own workspace (read off the current page's own slug, never the
 * denied one) actually holds, so a screen leaking the DENIED workspace's
 * rows on top of the reader's own still fails this count exactly as before.
 *
 * IT IS NOT A DETECTOR FOR THE TENANCY PROCESSOR, and the feature file records
 * the measurement: with `bb_read_scope` removed from the live index this step
 * still passed, because search_api's Views query plugin access-checks every
 * returned item on top of the narrowed query. The isolating test is
 * `TicketIndexReadScopeTest`, which asks the index rather than the view.
 */
Then('no ticket of the {string} workspace is listed', async ({ page }, slug: string) => {
  const identifiersOf = (workspaceSlug: string): string[] =>
    php(
      [
        '$out = [];',
        'foreach (\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadMultiple() as $t) {',
        '$p = $t->get("project_id")->entity;',
        '$g = $p ? $p->get("group_id")->entity : NULL;',
        '$w = $g ? $g->get("workspace_id")->entity : NULL;',
        `if ($w && (string) $w->get("slug")->value === "${safe(workspaceSlug)}") {`,
        '$out[] = (string) $t->get("identifier")->value; } }',
        'print implode(",", array_filter($out));',
      ].join(' '),
    )
      .split(',')
      .filter((identifier) => identifier !== '');

  const identifiers = identifiersOf(slug);
  expect(identifiers.length, `The "${slug}" workspace has no tickets to be denied.`)
    .toBeGreaterThan(0);

  const target = active(page);
  const readerSlugMatch = /^\/([^/]+)\//.exec(new URL(target.url()).pathname);
  const readerSlug = readerSlugMatch?.[1] ?? '';
  const ownIdentifiers = readerSlug && readerSlug !== slug ? identifiersOf(readerSlug) : [];

  // `.table__row` rather than `[data-row-url]` (BB-413 deleted the
  // attribute). Comparing against the READER's own count, not a hard 0, is
  // what still catches a screen leaking every row: the denied workspace's
  // tickets would inflate this count past the reader's own.
  await expect(target.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`)).toHaveCount(ownIdentifiers.length);

  const body = await target.locator('body').innerText();
  for (const identifier of identifiers) {
    expect(body, `${identifier} is on a screen it must not reach.`).not.toContain(identifier);
  }
});

// Contextual pages use the same facet controls and native page-content transport.
let contextualPath = '';
let contextualStatus = 0;

When('I visit the contextual tickets for the project {string}', async ({ page }, name: string) => {
  const id = php(
    '$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $p ? $p->id() : "";`,
  );
  expect(id, 'The recipe supplies the contextual project').not.toBe('');
  contextualPath = `/bakers/project/${id}/tickets`;
  const response = await page.goto(contextualPath);
  contextualStatus = response?.status() ?? 0;
});

When('I open the next contextual ticket page', async ({ page }) => {
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect(page).toHaveURL(/page=1/);
});

Then('the contextual ticket route is unchanged', async ({ page }) => {
  expect(new URL(active(page).url()).pathname).toBe(contextualPath);
});

Then('the contextual ticket page denies access', async ({ page }) => {
  expect([403, 404]).toContain(contextualStatus);
  await expect(page.locator('[data-component-id="bb_theme:list"]')).toHaveCount(0);
});

When('I open a contextual filter with no matches', async ({ page }) => {
  const target = active(page);
  const url = new URL(target.url());
  url.search = 'state[0]=cancelled';
  await target.goto(url.toString());
});

Then('the contextual no-match message is visible', async ({ page }) => {
  const target = active(page);
  await expect(target.getByText('No entries match the selected filters.')).toBeVisible();
  await expect(target.locator('[data-component-id="bb_theme:list"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// BB-490 — the open/closed/all segmented control beside a listing.
//
// THE FIXTURES ARE TIED TO `listing.uid`. `my_work` narrows to the reader's
// own tickets, so an open and a closed row have to belong to whichever
// account the `Given` step signed in as, not to a fixed uid a seed happened to
// produce. Create-if-absent by title, like the tall-ticket fixture above: idle
// on a second run of the same scenario and reproducible from a fresh
// `ddev init --provider recipe-test` world, needing only the seeded `bakers.build`
// project.
//
// THE CLOSED ROW HAS NO `claim_expires_at` OF ITS OWN — that field lives on
// `bb_run`, not `bb_ticket` — so the footgun this suite otherwise guards
// against (a fixed past timestamp turning into a time-dependent 403) does not
// apply here. `closed` itself is a self-healing projection of terminality
// (`TicketClosure::closeIfTerminal()`): saving the ticket in a terminal state
// (`done`) is what sets it, not a field written directly.
// ---------------------------------------------------------------------------

const OPEN_FIXTURE_TICKET_TITLE = 'BB-490 open fixture ticket';
const CLOSED_FIXTURE_TICKET_TITLE = 'BB-490 closed fixture ticket';

Given('the workspace has an open ticket and a closed ticket assigned to me', async () => {
  if (listing.uid === null) {
    throw new Error('No account was signed in, so there is nobody to assign these tickets to.');
  }
  const snippet = [
    '$etm = \\Drupal::entityTypeManager();',
    '$ts = $etm->getStorage("bb_ticket");',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    `$open = current($ts->loadByProperties(["title" => "${OPEN_FIXTURE_TICKET_TITLE}"]));`,
    'if (!$open) {',
    `$open = $ts->create(["project_id" => $p->id(), "title" => "${OPEN_FIXTURE_TICKET_TITLE}", "workflow" => "bb_work", "state" => "working", "assignee_user_id" => ${listing.uid}]);`,
    '} else {',
    `$open->set("state", "working")->set("assignee_user_id", ${listing.uid});`,
    '}',
    // A real change on every run: re-saving an unchanged ticket keeps its old
    // `changed`, and fresher fixtures then push it off the first page.
    '$open->setChangedTime(\\Drupal::time()->getCurrentTime())->save();',
    `$closed = current($ts->loadByProperties(["title" => "${CLOSED_FIXTURE_TICKET_TITLE}"]));`,
    'if (!$closed) {',
    `$closed = $ts->create(["project_id" => $p->id(), "title" => "${CLOSED_FIXTURE_TICKET_TITLE}", "workflow" => "bb_work", "state" => "done", "assignee_user_id" => ${listing.uid}]);`,
    '} else {',
    `$closed->set("state", "done")->set("assignee_user_id", ${listing.uid});`,
    '}',
    '$closed->setChangedTime(\\Drupal::time()->getCurrentTime())->save();',
    'print "OK";',
  ].join(' ');
  const result = php(snippet);
  if (!result.includes('OK')) {
    throw new Error(`The open/closed ticket fixtures did not settle: "${result}".`);
  }
  // Adds this scenario's own two fixtures; removes nothing, so safe alongside
  // a concurrent worker indexing its own additions.
  Drush.exec('search-api:index bb_tickets');
});


Then('I see the closed ticket', async ({ page }) => {
  await expect(
    active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: CLOSED_FIXTURE_TICKET_TITLE }),
  ).toHaveCount(1);
});

Then('I do not see the closed ticket', async ({ page }) => {
  await expect(
    active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: CLOSED_FIXTURE_TICKET_TITLE }),
  ).toHaveCount(0);
});

Then('I do not see the open ticket', async ({ page }) => {
  await expect(
    active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: OPEN_FIXTURE_TICKET_TITLE }),
  ).toHaveCount(0);
});

Then('I see the open ticket', async ({ page }) => {
  await expect(
    active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`, { hasText: OPEN_FIXTURE_TICKET_TITLE }),
  ).toHaveCount(1);
});

/** The tally fixture this scenario assigned to the reader, for the `After` handback. */
let tallyFixture: { name: string; count: number } | null = null;

/**
 * Tickets "<title> 1", "<title> 2", … assigned to the reader in project BB, one
 * per listed state. Create-if-absent by title and re-set on every run, like the
 * open/closed fixture above, so a reused site and a parallel worker agree; a
 * terminal state closes its ticket on save. Project BB is in team "Design
 * Crew", so the same tickets show on My work, the project tab and the team tab,
 * and one title search narrows each list to exactly them.
 */
Given(
  'tickets titled {string} are assigned to me in the states {string}',
  async ({}, title: string, states: string) => {
    if (listing.uid === null) {
      throw new Error('No account was signed in, so there is nobody to assign these tickets to.');
    }
    const name = safe(title);
    const snippet = [
      '$etm = \\Drupal::entityTypeManager();',
      '$ts = $etm->getStorage("bb_ticket");',
      '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
      'if (!$p) { print "NO_PROJECT"; return; }',
      ...states.split(',').map((state, i) => [
        `$t = current($ts->loadByProperties(["title" => "${name} ${i + 1}"]))`,
        `?: $ts->create(["project_id" => $p->id(), "title" => "${name} ${i + 1}", "workflow" => "bb_work"]);`,
        `$t->set("state", "${safe(state.trim())}")->set("assignee_user_id", ${listing.uid})->save();`,
      ].join(' ')),
      'print "OK";',
    ].join(' ');
    tallyFixture = { name, count: states.split(',').length };
    const result = php(snippet);
    if (!result.includes('OK')) {
      throw new Error(`The "${title}" tickets did not settle: "${result}".`);
    }
    Drush.exec('search-api:index bb_tickets');
  },
);

/**
 * Hands the tally tickets back, unassigned, after success or failure. Left
 * assigned they would push the reader's open work past one page, and "My work
 * is the nav home" compares every open ticket of the reader with the first page.
 */
After(async () => {
  if (tallyFixture === null) {
    return;
  }
  const { name, count } = tallyFixture;
  tallyFixture = null;
  php([
    '$ts = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
    ...Array.from({ length: count }, (_, i) => `foreach ($ts->loadByProperties(["title" => "${name} ${i + 1}"]) as $t) { $t->set("assignee_user_id", NULL)->save(); }`),
  ].join(' '));
  Drush.exec('search-api:index bb_tickets');
});

/** The ticket family this scenario assigned to the reader: title => identifier. */
let familyFixture: Record<string, string> | null = null;

/** The identifier of one ticket of the family fixture. */
function familyKey(title: string): string {
  const key = familyFixture?.[title];
  if (!key) {
    throw new Error(`"${title}" is not a ticket of the family fixture.`);
  }
  return key;
}

/**
 * "<name> parent" with the sub-tickets "<name> child 1" and "<name> child 2",
 * and "<name> grandchild" under child 1: open and assigned to the reader in
 * project BB, so My work, the project tab and team "Design Crew" list them.
 * Create-if-absent by title and re-set on every run, like the tally fixture.
 */
Given('the ticket family {string} is assigned to me', async ({}, name: string) => {
  if (listing.uid === null) {
    throw new Error('No account was signed in, so there is nobody to assign these tickets to.');
  }
  const n = safe(name);
  // Parents first, so every child points at an id that already exists.
  const tree: Array<[string, string | null]> = [
    [`${n} parent`, null],
    [`${n} child 1`, `${n} parent`],
    [`${n} child 2`, `${n} parent`],
    [`${n} grandchild`, `${n} child 1`],
  ];
  const result = php([
    '$etm = \\Drupal::entityTypeManager();',
    '$ts = $etm->getStorage("bb_ticket");',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    '$ids = []; $keys = [];',
    ...tree.map(([title, parent]) => [
      `$t = current($ts->loadByProperties(["title" => "${title}"]))`,
      `?: $ts->create(["project_id" => $p->id(), "title" => "${title}", "workflow" => "bb_work"]);`,
      `$t->set("state", "working")->set("assignee_user_id", ${listing.uid})`,
      `->set("parent_id", ${parent === null ? 'NULL' : `$ids["${parent}"]`})->save();`,
      `$ids["${title}"] = $t->id(); $keys["${title}"] = $t->getIdentifier();`,
    ].join(' ')),
    'print json_encode($keys);',
  ].join(' '));
  if (!result.startsWith('{')) {
    throw new Error(`The "${name}" family did not settle: "${result}".`);
  }
  familyFixture = JSON.parse(result) as Record<string, string>;
  Drush.exec('search-api:index bb_tickets');
});

/**
 * Deletes the family after success or failure. Left behind, four fresh open
 * tickets in project BB would push other scenarios' fixtures off the first
 * page and into the State counts they measure.
 */
After(async () => {
  if (familyFixture === null) {
    return;
  }
  const titles = Object.keys(familyFixture).map((title) => `"${title}"`).join(', ');
  familyFixture = null;
  php([
    '$ts = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
    `$ids = $ts->getQuery()->accessCheck(FALSE)->condition("title", [${titles}], "IN")->execute();`,
    '$ts->delete($ts->loadMultiple($ids));',
  ].join(' '));
  Drush.exec('search-api:index bb_tickets');
});

/** Reopens the current list with `parent=<the family ticket's key>`. */
When('I open this list for the parent {string}', async ({ page }, title: string) => {
  const target = active(page);
  const url = new URL(target.url());
  url.searchParams.set('parent', familyKey(title));
  const response = await target.goto(url.toString());
  expect(response?.status() ?? 0, `${url} did not render`).toBeLessThan(400);
});

Then(
  'the address carries the key of {string} as {string}',
  async ({ page }, title: string, parameter: string) => {
    const key = familyKey(title);
    await expect.poll(() => new URL(active(page).url()).searchParams.get(parameter)).toBe(key);
  },
);

Then('the address does not carry the key of {string}', async ({ page }, title: string) => {
  const key = familyKey(title);
  expect([...new URL(active(page).url()).searchParams.values()]).not.toContain(key);
});

/**
 * One chip reads "<field> is <KEY> · <title>". Read off the chip itself: the
 * project and team tabs render the chips without the outer strip wrapper.
 */
Then(
  'the active filters read the key and title of {string} as {string}',
  async ({ page }, title: string, field: string) => {
    const chips = active(page).locator(`${CONTENT_ISLAND} [data-facet]`);
    await expect(chips.filter({ hasText: `${field} is ${familyKey(title)} · ${title}` })).toHaveCount(1);
  },
);

/** Ticks one checkbox of the filters aside; auto-submit applies it. */
When('I switch on {string}', async ({ page }, label: string) => {
  const target = active(page);
  const before = await target.evaluate(() => window.location.search);
  await target.locator(`${CONTENT_ISLAND} aside`).getByRole('checkbox', { name: label }).check();
  await target.waitForFunction((previous) => window.location.search !== previous, before, { timeout: 20000 });
});

/**
 * The listing holds exactly the named tickets: one row each, and no other row.
 * Meant after a search that narrows the list to a fixture's own tickets.
 */
Then('the ticket listing lists exactly the tickets {string}', async ({ page }, titles: string) => {
  const rows = active(page).locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`);
  const expected = titles.split(',').map((title) => title.trim());
  for (const title of expected) {
    // `(?!\d)`: "State tally 1" must not also match "State tally 10".
    await expect(rows.filter({ hasText: new RegExp(`${title}(?!\\d)`) }), `"${title}" is not listed once`).toHaveCount(1);
  }
  await expect(rows).toHaveCount(expected.length);
});

Then('the facets sit in the filters aside, not above the ticket listing', async ({ page }) => {
  const aside = page.locator(`${CONTENT_ISLAND} aside`);
  await expect(aside).toHaveCount(1);
  await expect(aside.locator('form')).toHaveCount(1);
  await expect(aside.getByRole('combobox', { name: /^Change State\./ })).toBeVisible();
});

Then('the page carries exactly one main heading and one workspace description', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByText(/^Every ticket in the .+ workspace/)).toHaveCount(1);
});

Then('exactly one active-filters strip sits above the ticket listing', async ({ page }) => {
  const strips = page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:active-filters"]`);
  await expect(strips).toHaveCount(1);
  const above = await strips.first().evaluate(
    (strip, table) => Boolean(strip.compareDocumentPosition(table as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).elementHandle(),
  );
  expect(above, 'the active filters do not sit above the ticket listing').toBe(true);
});

Then('the {string} facet offers {string}', async ({ page }, facet: string, labels: string) => {
  for (const label of labels.split(',').map((value) => value.trim())) {
    await facetRow(page, facet, label);
  }
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// Contextual filter matrices — each display offers only the filters that can
// still distinguish its rows, in one shared order.
// ---------------------------------------------------------------------------

/**
 * Every filter control of the exposed form, in DOM order, named as an
 * operator reads it. The closed-rows group reads as "Closed"; a facet reads
 * as the field its `Change <field>.` accessible name carries.
 */
async function exposedFilterNames(page: Page): Promise<string[]> {
  return active(page)
    .locator(`${CONTENT_ISLAND} aside`)
    .locator('[role="group"][aria-label="Closed rows"], [role="combobox"][aria-label^="Change "]')
    .evaluateAll((controls) =>
      controls.map((control) => {
        const name = control.getAttribute('aria-label') || '';
        return control.getAttribute('role') === 'group' ? 'Closed' : name.replace(/^Change (.+?)\.\s.*$/s, '$1');
      }),
    );
}

Then('the filters read {string} in order', async ({ page }, names: string) => {
  const expected = names.split(',').map((name) => name.trim());
  await expect.poll(() => exposedFilterNames(page)).toEqual(expected);
});

// A project only its own scenario writes to: parallel workers change the shared
// "bakers.build Platform" between two reads. Same group, teams and owner as that
// project; open tickets stay in `qualification` so workspace-wide "Working"
// facet counts are untouched. Idempotent on a reused site.
Given('a dedicated project {string} has {int} open tickets', ({}, name: string, count: number) => {
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$ps = $etm->getStorage("bb_project");',
      `$project = current($ps->loadByProperties(["name" => "${safe(name)}"]));`,
      'if (!$project) {',
      '$src = current($ps->loadByProperties(["name" => "bakers.build Platform"]));',
      'if (!$src) { throw new \\RuntimeException("Need bakers.build Platform"); }',
      '$teams = [];',
      'foreach ($src->get("teams") as $item) { $teams[] = $item->target_id; }',
      `$project = $ps->create(["name" => "${safe(name)}", "group_id" => $src->get("group_id")->target_id, "teams" => $teams, "owner_user_id" => $src->get("owner_user_id")->target_id]);`,
      '$project->save();',
      '}',
      '$ts = $etm->getStorage("bb_ticket");',
      '$open = count($ts->loadByProperties(["project_id" => $project->id(), "closed" => 0]));',
      `for ($i = $open; $i < ${count}; $i++) {`,
      '$ts->create(["project_id" => $project->id(), "title" => "Contextual fixture " . ($i + 1), "workflow" => "bb_work", "state" => "qualification", "team" => $project->get("teams")->target_id])->save();',
      '}',
    ].join(' '),
  );
  Drush.exec('search-api:index bb_tickets');
});

let listedBefore: string[] = [];

async function listedIdentifiers(page: Page): Promise<string[]> {
  return (
    await active(page)
      .locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item] [data-cell="identifier"]`)
      .allInnerTexts()
  )
    .map((text) => text.trim())
    .sort();
}

When('I note the listed tickets', async ({ page }) => {
  listedBefore = await listedIdentifiers(page);
  expect(listedBefore.length, 'There is no baseline to compare against.').toBeGreaterThan(0);
});

/**
 * Reopens the current address with query keys this display no longer
 * exposes. A key that still reached the query would narrow or widen the rows.
 */
When('I reopen the address with the removed keys {string}', async ({ page }, query: string) => {
  const target = active(page);
  const url = new URL(target.url());
  for (const [key, value] of new URLSearchParams(query)) {
    url.searchParams.append(key, value);
  }
  const response = await target.goto(url.toString());
  expect(response?.status() ?? 0, 'The address with removed keys did not render').toBeLessThan(400);
});

Then('the listed tickets are unchanged', async ({ page }) => {
  expect(await listedIdentifiers(page)).toEqual(listedBefore);
});

/**
 * A display without a header word renders no strip at all while nothing is
 * active (`views_filters_summary` returns no summary), and that absence is the
 * claim: no removed key became an active filter.
 */
Then('no active filter names {string}', async ({ page }, names: string) => {
  const strip = active(page).locator('[data-component-id="bb_theme:active-filters"]');
  if ((await strip.count()) === 0) {
    return;
  }
  const text = (await strip.first().innerText()).replace(/\s+/g, ' ');
  for (const name of names.split(',').map((value) => value.trim())) {
    expect(text, `The active filters name "${name}"`).not.toContain(name);
  }
});

// ---------------------------------------------------------------------------
// Origin search: tickets found by the origin issue they came from.
// ---------------------------------------------------------------------------

/** Title prefix of the origin fixtures, so the steps can name them briefly. */
const ORIGIN_FIXTURE_PREFIX = 'Origin search fixture';

/** Fixture title suffix → origin URL, on the "bakers.build Platform" repository. */
const ORIGIN_FIXTURES: Record<string, string> = {
  'issue 19': 'https://gitlab.example.com/bakers/bakers/-/issues/19',
  'issue 190': 'https://gitlab.example.com/bakers/bakers/-/issues/190',
  'issue 20 first': 'https://gitlab.example.com/bakers/bakers/-/issues/20',
  'issue 20 second': 'https://gitlab.example.com/bakers/bakers/issues/20/',
};

Given('the workspace has tickets from origin issues 19, 190 and twice 20', async () => {
  const upserts = Object.entries(ORIGIN_FIXTURES).map(([name, origin]) => [
    `$t = current($ts->loadByProperties(["title" => "${ORIGIN_FIXTURE_PREFIX} ${name}"]));`,
    `if (!$t) { $t = $ts->create(["project_id" => $p->id(), "title" => "${ORIGIN_FIXTURE_PREFIX} ${name}", "workflow" => "bb_work"]); }`,
    // `plan`, not `working`: the facet scenarios pick Working and Review and
    // compare row counts, so fixtures there would fill their page.
    `$t->set("state", "plan")->set("origin", "${origin}")->save();`,
  ].join(' '));
  const result = php([
    '$etm = \\Drupal::entityTypeManager();',
    '$ts = $etm->getStorage("bb_ticket");',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    ...upserts,
    'print "OK";',
  ].join(' '));
  if (!result.includes('OK')) {
    throw new Error(`The origin fixtures did not settle: "${result}".`);
  }
  Drush.exec('search-api:index bb_tickets');
});

When('I search the ticket list for {string}', async ({ page }, query: string) => {
  const box = active(page).locator('input[name="title"]').first();
  await box.fill(query);
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('title') === query),
    box.press('Enter'),
  ]);
});

/** The listed rows whose title names the given origin fixture. */
function originRow(page: Page, name: string) {
  return active(page).locator(
    `${CONTENT_ISLAND} [data-component-id="bb_theme:list"] li[data-list-item]`,
    // `(?!\\d)`: "issue 19" must not also match "issue 190".
    { hasText: new RegExp(`${ORIGIN_FIXTURE_PREFIX} ${name}(?!\\d)`) },
  );
}

Then('the ticket list shows the origin tickets {string}', async ({ page }, names: string) => {
  for (const name of names.split(',').map((n) => n.trim())) {
    await expect(originRow(page, name), `"${name}" is not listed`).toHaveCount(1);
  }
});

Then('the ticket list does not show the origin ticket {string}', async ({ page }, name: string) => {
  await expect(originRow(page, name)).toHaveCount(0);
});
