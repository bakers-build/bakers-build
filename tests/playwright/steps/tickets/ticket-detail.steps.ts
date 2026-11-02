// BB-414 — the ticket detail screen (spec D9, plan Tasks 8 and 9).
//
// Every assertion here is a BROWSER assertion, for the reason BB-396 recorded
// when it restored this suite: an island is a client-side mechanism, and no
// Storybook story and no PHP test can observe whether a click kept the
// document. The detectors are the team suite's — imported, never re-invented —
// so "the document was not reloaded" means one thing across both surfaces.
//
// THE SECOND CLICK IS THE ASSERTION. See the header of steps/team/team-islands.steps.ts.
import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { markDocument } from '../../support/shell';

/**
 * Runs a PHP snippet through drush and returns its stdout.
 *
 * Shell quoting, exactly as support/steps/shell.steps.ts measured it: the snippet is
 * wrapped in SINGLE quotes, so `$vars` survive untouched and must NOT be
 * backslash-escaped. Its one rule is that the snippet contains no single quote
 * of its own — every PHP string below is double-quoted for that reason.
 */
function php(snippet: string): string {
  if (snippet.includes("'")) {
    throw new Error('A drush ev snippet must contain no single quote.');
  }
  return Drush.exec(`ev '${snippet}'`).trim();
}

/** Strips the characters that would break out of a double-quoted PHP string. */
function safe(value: string): string {
  return value.replace(/["'\\$]/g, '');
}

/**
 * The public URL of a ticket, resolved by its identifier rather than hardcoded.
 *
 * Asking Drupal for the entity's own toUrl() is what keeps the scenario working
 * through the workspace path processor, which rewrites `/bakers/…` to
 * `/_workspace/bakers/…` inbound and back outbound — and through the identifier
 * converter, which is case-insensitive while toUrl() emits the lower-cased
 * form. Neither is a fact a hardcoded path would carry.
 */
function ticketUrl(identifier: string): string {
  const url = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")' +
      `->loadByProperties(["identifier" => "${safe(identifier)}"]))) ? $e->toUrl()->toString() : "");`,
  );
  if (!url) {
    throw new Error(`No bb_ticket "${identifier}" exists in the seeded world.`);
  }
  return url;
}

// Registered ONCE, under Given. playwright-bdd matches a step by its TEXT and
// not by its keyword, so a second registration under When would be a duplicate
// definition and an error — the feature file is free to write either.
Given('I visit the ticket {string}', async ({ page }, identifier: string) => {
  await page.goto(ticketUrl(identifier));
  await markDocument(page);
});

When('I go back', async ({ page }) => {
  await page.goBack();
});

// ---------------------------------------------------------------------------
// The canvas (AC 3).
// ---------------------------------------------------------------------------

/** The screen's one work surface — `bb_theme:canvas`'s component root. */
const CANVAS = '[data-component-id="bb_theme:canvas"]';

Then('exactly one canvas is present in the document', async ({ page }) => {
  await expect(page.locator(CANVAS)).toHaveCount(1);
});

// Asserted against the team screen too (a @negative-control scenario), because
// a selector with a typo in it is empty everywhere and this claim is a NEGATIVE
// on every other scenario that makes it.
Then('no canvas is present in the document', async ({ page }) => {
  await expect(page.locator(CANVAS)).toHaveCount(0);
});

Then('the canvas has a header region', async ({ page }) => {
  await expect(page.locator('[data-canvas-region="header"]')).toHaveCount(1);
});

Then('the canvas has a main region', async ({ page }) => {
  await expect(page.locator('[data-canvas-region="main"]')).toHaveCount(1);
});

Then('the canvas has an inspector region', async ({ page }) => {
  await expect(page.locator('[data-canvas-region="inspector"]')).toHaveCount(1);
});

// D1: "`canvas.filters` stays empty — a detail screen has no facets." The
// template drops the column entirely when its slot is empty, so the absence of
// the node is the checkable form of that decision.
Then('the canvas has no filter rail', async ({ page }) => {
  await expect(page.locator('[data-canvas-region="filters"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The summary band (AC 4, AC 6).
// ---------------------------------------------------------------------------

function bandRegion(page: Page, name: string): Locator {
  const region = page.locator(`.summary-band__${name}`);
  return region;
}

Then(
  'the band region {string} comes before the band region {string}',
  async ({ page }, first: string, second: string) => {
    const a = bandRegion(page, first);
    const b = bandRegion(page, second);
    await expect(a).toHaveCount(1);
    await expect(b).toHaveCount(1);
    // Node.compareDocumentPosition is the only DOM-order answer that does not
    // depend on the two nodes being siblings — and they are not: `flow` sits in
    // summary-band__header while `summary` and `links` sit in
    // summary-band__body.
    const handleA = await a.elementHandle();
    const handleB = await b.elementHandle();
    const follows = await page.evaluate(
      ([x, y]) =>
        Boolean(
          (x as Element).compareDocumentPosition(y as Element) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      [handleA, handleB],
    );
    expect(follows, `${second} should follow ${first} in the DOM`).toBe(true);
  },
);

Then('the band shows exactly the link groups {string}', async ({ page }, expected: string) => {
  const wanted = expected.split(',').map((label) => label.trim());
  // textContent, not innerText. The label carries Tailwind's `uppercase`, so
  // innerText comes back as "CODE" — a rendering of the group name and not the
  // name. What D5 fixes is the name the grouper emits ("Code"), and a scenario
  // that spelled it in caps would start failing the day the type scale changed
  // its mind about case, which is not this criterion.
  const labels = await page.locator('.summary-band__links .link-group__label').allTextContents();
  expect(labels.map((label) => label.trim())).toEqual(wanted);
});

// ---------------------------------------------------------------------------
// The tab row (AC 8).
// ---------------------------------------------------------------------------

/**
 * The tab row, in BOTH forms the shell can produce.
 *
 * `[data-tabs]` is `bb_theme:tabs`, which the theme's menu-local-tasks template
 * emits; `[data-bakers-tab-body]` is the hull the team screen's tab controller
 * renders under it. A screen with either has a tab row, so both are asked.
 */
const TAB_ROW = '[data-tabs], [data-bakers-tab-body]';

Then('no tab row is present', async ({ page }) => {
  await expect(page.locator(TAB_ROW)).toHaveCount(0);
});

Then('a tab row is present', async ({ page }) => {
  expect(await page.locator(TAB_ROW).count()).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// The handoff stream (AC 7).
// ---------------------------------------------------------------------------

/** The handoff stream — `bb_theme:collapsible`, inside the body. */
function handoffStream(page: Page): Locator {
  return page.locator('[data-canvas-region="main"] details.collapsible');
}

// "Native" is the whole claim: collapsible.twig ships no .js file, so the
// control works with JavaScript disabled. Asserting the tag name is what makes
// a scripted accordion fail this instead of quietly replacing it.
// A long description is clamped behind Show more; the toggle exists only
// while the clamped text overflows.
When('I expand the description', async ({ page }) => {
  const main = page.locator('[data-canvas-region="main"]');
  await main.getByRole('button', { name: 'Show more' }).click();
  await expect(main.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
});

// The handoff section renders only when there are handoffs.
Then('no handoff stream is shown', async ({ page }) => {
  await expect(handoffStream(page)).toHaveCount(0);
});

Then('the handoff stream is a native details element', async ({ page }) => {
  const stream = handoffStream(page);
  await expect(stream).toHaveCount(1);
  await expect(stream.locator('> summary')).toHaveCount(1);
});

// AC 7's ordering: run history above, the stream LAST. Asserted by walking from
// the stream up to the body and requiring it to be the last element child at
// every hop — "nothing in the body comes after it", which a sibling-index check
// would only answer for one level.
Then('the handoff stream is the last block in the main region', async ({ page }) => {
  // Reports WHAT follows the stream rather than just "false", so a failure
  // names the block that was rendered after it instead of sending the next
  // reader back to the DOM to find out.
  const verdict = await handoffStream(page).evaluate((node: Element) => {
    let current: Element | null = node;
    while (current !== null && current.getAttribute('data-canvas-region') !== 'main') {
      const parent: Element | null = current.parentElement;
      if (parent === null) {
        return "the handoff stream is not inside the canvas' main region";
      }
      if (parent.lastElementChild !== current) {
        const after = parent.lastElementChild;
        return `something follows the handoff stream: <${after?.tagName.toLowerCase()} class="${after?.className}">`;
      }
      current = parent;
    }
    return 'last';
  });
  expect(verdict).toBe('last');
});

Then('the handoff stream is closed', async ({ page }) => {
  await expect(handoffStream(page)).not.toHaveAttribute('open', /.*/);
});

Then('the handoff stream is open', async ({ page }) => {
  await expect(handoffStream(page)).toHaveAttribute('open', /.*/);
});

When('I open the handoff stream', async ({ page }) => {
  const stream = handoffStream(page);
  if (!(await stream.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await stream.locator('> summary').click();
  }
  await expect(stream).toHaveAttribute('open', /.*/);
});

// ---------------------------------------------------------------------------
// The sticky inspector (AC 9).
//
// THE CRITERION NO OTHER SCENARIO IN THIS SUITE CAN STAND IN FOR, and the
// reason the defect it guards survived six contract suites, 980 PHPUnit tests
// and 31 browser scenarios: `position: sticky` only does anything when the
// element's CONTAINING BLOCK is taller than the element, and nothing on the
// seeded world is tall enough to scroll past the inspector — BB-142 carries
// 577 characters of handoff across three comments and every other ticket
// carries none. A class-list assertion cannot see this at all: the markup
// declared `sticky top-0` the whole time it did not stick.
//
// So the subject has to be MANUFACTURED (a body taller than the viewport) and
// the claim has to be GEOMETRIC (the aside's `top` after scrolling). Both
// halves of the criterion are asserted here, because they pull against each
// other: the fix for "it does not stick" is a taller containing block, and the
// wrong fix for it — an `overflow` anywhere on the chain — is exactly what
// would re-break "a picker opened at its bottom is not clipped" (D3/D12,
// BB-332 R9).
// ---------------------------------------------------------------------------

/** The inspector itself — `bb_theme:inspector`'s <aside>, inside its cell. */
const INSPECTOR_ASIDE = '[data-canvas-region="inspector"] .inspector';

/**
 * The title of the manufactured tall ticket. Read back rather than assumed:
 * `identifier` is computed from the project key and a per-project counter, so
 * the fixture cannot name the ticket it is about to create.
 */
const TALL_TICKET_TITLE = 'A ticket whose body is taller than the viewport';

let tallTicketIdentifier: string | null = null;

/**
 * A ticket whose rendered body is several viewports tall.
 *
 * Create-if-absent, like the foreign-workspace fixture above, so it is
 * idempotent within a run and reproducible from a fresh
 * `ddev init --provider recipe-test` world: it needs only the seeded `bakers.build`
 * project and adds everything else itself. 200 paragraphs is not a round
 * number chosen for looks — it renders about 10,500px of main column at the
 * suite's 1280x720 viewport, which leaves the scroll of this scenario well
 * inside the grid row rather than at its very end, where sticky legitimately
 * releases.
 */
Given('the workspace has a ticket whose body is taller than the viewport', async () => {
  const snippet = [
    '$etm = \\Drupal::entityTypeManager();',
    '$ts = $etm->getStorage("bb_ticket");',
    `$t = current($ts->loadByProperties(["title" => "${TALL_TICKET_TITLE}"]));`,
    'if (!$t) {',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    '$body = str_repeat("A paragraph of handoff prose, repeated so that this body is taller than any viewport this suite runs in.\\n\\n", 200);',
    `$t = $ts->create(["project_id" => $p->id(), "title" => "${TALL_TICKET_TITLE}", "workflow" => "bb_work", "state" => "working", "description" => ["value" => $body, "format" => "bb_rich"]]);`,
    '$t->save();',
    '}',
    'print $t->get("identifier")->value;',
  ].join(' ');
  const identifier = php(snippet).split('\n').pop()?.trim();
  if (!identifier || identifier === 'NO_PROJECT') {
    throw new Error(`The tall-ticket fixture did not settle: "${identifier}".`);
  }
  tallTicketIdentifier = identifier;
});

When('I visit that tall ticket', async ({ page }) => {
  if (tallTicketIdentifier === null) {
    throw new Error('No tall ticket has been created in this scenario.');
  }
  await page.goto(ticketUrl(tallTicketIdentifier));
  await markDocument(page);
});

// NON-VACUITY, first half. Sticky is inert on a page that cannot scroll, so a
// scenario that never established a tall subject would pass against a broken
// rail without ever moving.
Then('the main region is at least {int} pixels tall', async ({ page }, minimum: number) => {
  const box = await page.locator('[data-canvas-region="main"]').boundingBox();
  expect(box, 'the canvas has a main region').not.toBeNull();
  expect(
    box!.height,
    `the main region is ${Math.round(box!.height)}px tall — the fixture did not produce a scrollable body`,
  ).toBeGreaterThanOrEqual(minimum);
});

/**
 * The other half of AC 9, and the half that already passed: the inspector is
 * not a scroll container and no ancestor of it establishes one either.
 *
 * Asserted as a WALK rather than as a single computed style, because every
 * property named here creates a containing block or a clipping context for the
 * absolutely positioned picker panels a `meta_row` opens, and any one of them
 * anywhere on the chain would clip a picker opened at the inspector's bottom
 * edge. The walk reports the offending node and the offending declaration, so
 * a failure names the ancestor instead of sending the next reader to the
 * DOM inspector.
 *
 * IT IS A PROXY, AND THE DIRECT MEASUREMENT IS NOT EXPRESSIBLE HERE. The
 * sharper assertion — open the bottom-most picker and measure its panel's
 * bounding box against the viewport — needs a panel in the DOM, and on this
 * delivery there is none to measure: every picker is rendered INERT and closed
 * (`open: false`, no form, no route, no submit handler), so nothing a test can
 * click produces one. The proxy asserts the precondition instead, which is the
 * only observable form until the write layer lands; that ticket is where the
 * measurement belongs, and it is the ticket that will have something to
 * measure.
 *
 * THE WALK REACHES `<html>`, NOT ONLY `<body>` (BB-414, second review gate).
 * It used to stop at the body, so an `overflow: hidden` or a `transform` on the
 * root element — the single most common way a theme clips a whole page — was
 * the one clipping context this assertion could not see, which is a hole in
 * exactly the direction the proxy exists to cover.
 */
Then('nothing between the inspector and the document clips it', async ({ page }) => {
  const offenders = await page.locator(INSPECTOR_ASIDE).evaluate((node: Element) => {
    const found: string[] = [];
    let current: Element | null = node;
    while (current !== null) {
      const style = getComputedStyle(current);
      const reasons: string[] = [];
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        reasons.push(`overflow: ${style.overflowX} / ${style.overflowY}`);
      }
      if (style.contain !== 'none') {
        reasons.push(`contain: ${style.contain}`);
      }
      if (style.transform !== 'none') {
        reasons.push(`transform: ${style.transform}`);
      }
      if (style.clipPath !== 'none') {
        reasons.push(`clip-path: ${style.clipPath}`);
      }
      if (style.filter !== 'none') {
        reasons.push(`filter: ${style.filter}`);
      }
      if (reasons.length > 0) {
        found.push(
          `<${current.tagName.toLowerCase()} class="${current.getAttribute('class') ?? ''}"> — ${reasons.join('; ')}`,
        );
      }
      current = current === document.documentElement ? null : current.parentElement;
    }
    return found;
  });
  expect(
    offenders,
    'a picker opened at the inspector\'s bottom edge cannot escape any of these (D3/D12, BB-332 R9)',
  ).toEqual([]);
});

/** The scroll offset before the last `I scroll down` step, for non-vacuity. */
let scrollOffsetBefore = 0;

When('I scroll down {int} pixels', async ({ page }, pixels: number) => {
  scrollOffsetBefore = await page.evaluate(() => window.scrollY);
  await page.evaluate((amount) => window.scrollBy(0, amount), pixels);
  // One frame, so the sticky offset the assertions read is the settled one.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
});

// NON-VACUITY, second half. `window.scrollBy` on a document that cannot scroll
// is a silent no-op, and every geometric claim below would then be trivially
// true of a page that never moved.
Then('the page really scrolled at least {int} pixels', async ({ page }, pixels: number) => {
  const now = await page.evaluate(() => window.scrollY);
  expect(
    now - scrollOffsetBefore,
    `the document moved from y=${scrollOffsetBefore} to y=${now}`,
  ).toBeGreaterThanOrEqual(pixels);
});

// THE NEGATIVE CONTROL for the geometry, in the same scenario and against the
// same scroll: a region that is NOT sticky must have gone off the top. Without
// it, "the inspector's top is 0" would pass just as happily against a page that
// reported stale rectangles.
Then('the main region has scrolled off the top', async ({ page }) => {
  const top = await page
    .locator('[data-canvas-region="main"]')
    .evaluate((node: Element) => node.getBoundingClientRect().top);
  expect(top, `the main region's top is ${Math.round(top)} — it did not move`).toBeLessThan(-100);
});

// THE ASSERTION THAT CONVICTS. Before BB-414 fixed the containing block this
// read -1263 against a 1500px scroll: the cell carried `self-start` and so was
// exactly as tall as the aside (644.375px each), leaving sticky zero travel
// range, and the rail scrolled clean out of view while its class list still
// said `sticky top-0`.
Then('the inspector is still held at the top of the viewport', async ({ page }) => {
  const geometry = await page.locator(INSPECTOR_ASIDE).evaluate((node: Element) => {
    const cell = node.closest('[data-canvas-region="inspector"]');
    return {
      top: node.getBoundingClientRect().top,
      asideHeight: node.getBoundingClientRect().height,
      cellHeight: cell === null ? 0 : cell.getBoundingClientRect().height,
      scrollY: window.scrollY,
    };
  });
  const travel = Math.round(geometry.cellHeight - geometry.asideHeight);
  const why =
    `the inspector's top is ${Math.round(geometry.top)} at y=${Math.round(geometry.scrollY)}. ` +
    `Its containing block is ${Math.round(geometry.cellHeight)}px tall and the aside is ` +
    `${Math.round(geometry.asideHeight)}px, so sticky has ${travel}px of travel range` +
    (travel <= 0 ? ' — which is why it is inert.' : '.');
  expect(geometry.top, why).toBeGreaterThanOrEqual(-1);
  expect(geometry.top, why).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// Tenancy (AC 10, plan Task 8).
// ---------------------------------------------------------------------------

/**
 * The foreign-workspace fixture, and the reason it is drush and not seed
 * content.
 *
 * `recipes/bb_e2e/content/bb_workspace/` ships the second workspace
 * (`other`) DELIBERATELY EMPTY — it owns no group, no project and no ticket and
 * nobody is a member of it, because its shipped job is to be the wrong slug in
 * `/other/ticket/BB-142`. That covers the 404 half of this criterion and
 * nothing else: with no member and no ticket of its own, the 403 half — an
 * account that may see a workspace and is refused another one — has no subject.
 *
 * So this step supplies the missing subject and states it as a precondition
 * rather than inheriting it. It is create-if-absent throughout, so it is
 * idempotent within a run and reproducible from a fresh
 * `ddev init --provider recipe-test` world: everything it needs is the shipped
 * `other` workspace, and everything it adds it adds itself.
 */
Given('the other workspace has a project, a ticket and a member', async () => {
  const snippet = [
    '$etm = \\Drupal::entityTypeManager();',
    '$ws = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "other"]));',
    'if (!$ws) { print "NO_WORKSPACE"; return; }',
    '$gs = $etm->getStorage("bb_group");',
    '$g = current($gs->loadByProperties(["name" => "other crew"]));',
    'if (!$g) { $g = $gs->create(["name" => "other crew", "workspace_id" => $ws->id()]); $g->save(); }',
    // BB-462 D4/D5: project visibility comes from `teams`, not from the
    // workspace membership below — a project fixture with no team is
    // invisible to anyone but a workspace `lead`. This fixture needs
    // `south-contributor` to see the project through TEAM membership instead.
    '$tms = $etm->getStorage("bb_team");',
    '$tm = current($tms->loadByProperties(["name" => "other crew team"]));',
    'if (!$tm) { $tm = $tms->create(["name" => "other crew team", "workspace_id" => $ws->id()]); $tm->save(); }',
    '$ps = $etm->getStorage("bb_project");',
    '$p = current($ps->loadByProperties(["key" => "OTHER"]));',
    'if (!$p) { $p = $ps->create(["name" => "other project", "key" => "OTHER", "group_id" => $g->id(), "teams" => [$tm->id()]]); $p->save(); }',
    '$ts = $etm->getStorage("bb_ticket");',
    '$t = current($ts->loadByProperties(["identifier" => "OTHER-1"]));',
    'if (!$t) { $t = $ts->create(["project_id" => $p->id(), "title" => "Foreign workspace ticket", "workflow" => "bb_work", "state" => "working", "description" => ["value" => "A ticket that belongs to the other workspace.", "format" => "bb_rich"]]); $t->save(); }',
    '$us = $etm->getStorage("user");',
    '$u = current($us->loadByProperties(["name" => "south-contributor"]));',
    'if (!$u) { $u = $us->create(["name" => "south-contributor", "mail" => "south-contributor@example.test", "status" => 1]); $u->save(); }',
    // BB-462 D1: the implicit `member` rank grants nothing, so this
    // account needs the explicit `contributor` floor to reach anything at
    // all — the "ordinary member" this fixture models used to get that for
    // free.
    '$m = \\Drupal\\og\\Og::getMembership($ws, $u, \\Drupal\\og\\OgMembershipInterface::ALL_STATES) ?: \\Drupal\\og\\Og::createMembership($ws, $u);',
    '$m->setState("active");',
    '$m->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-contributor")]);',
    '$m->save();',
    '$tmm = \\Drupal\\og\\Og::getMembership($tm, $u, \\Drupal\\og\\OgMembershipInterface::ALL_STATES) ?: \\Drupal\\og\\Og::createMembership($tm, $u);',
    '$tmm->setState("active");',
    '$tmm->save();',
    'print $t->get("identifier")->value;',
  ].join(' ');
  const identifier = php(snippet).split('\n').pop()?.trim();
  if (identifier !== 'OTHER-1') {
    throw new Error(`The foreign-workspace fixture did not settle: "${identifier}".`);
  }
});

/**
 * The HTTP status of the last requested ticket page.
 *
 * Module-level because a playwright-bdd step cannot hand state to the next one.
 * Safe because it is reset by the requesting step, so two requests in one
 * scenario each report their own, independent of how many workers the run uses.
 */
let lastStatus: number | null = null;

// `page.goto` is used rather than `request.get`, and that is the point: the
// refusal has to be what a BROWSER carrying this account's session receives, on
// the same path a link would take. An API request would answer a different
// question.
When(
  'I request the ticket {string} in the workspace {string}',
  async ({ page }, identifier: string, slug: string) => {
    lastStatus = null;
    const response = await page.goto(`/${slug}/ticket/${identifier}`);
    if (response === null) {
      throw new Error('The navigation produced no response.');
    }
    lastStatus = response.status();
  },
);

Then('the response status is {int}', async ({}, expected: number) => {
  expect(lastStatus).toBe(expected);
});

const MAIN_REGION = '[data-canvas-region="main"]';

Then('the canvas header holds the summary band and no page header', async ({ page }) => {
  const header = page.locator('[data-canvas-region="header"]');
  await expect(header.locator('[data-component-id="bb_theme:summary-band"]')).toHaveCount(1);
  await expect(header.locator('[data-component-id="bb_theme:page_header"]')).toHaveCount(0);
});

Then('the inspector region holds exactly one inspector', async ({ page }) => {
  await expect(
    page.locator('[data-canvas-region="inspector"] [data-component-id="bb_theme:inspector"]'),
  ).toHaveCount(1);
});

/** The Run history heading, which goes with the rows it labels. */
function runHistoryHeading(page: Page) {
  return page.locator(MAIN_REGION).getByRole('heading', { name: 'Run history', exact: true });
}

Then('the run history shows {int} run rows', async ({ page }, count: number) => {
  await expect(runHistoryHeading(page)).toBeVisible();
  await expect(page.locator(`${MAIN_REGION} [data-cell="state"]`)).toHaveCount(count);
});

Then('every run row shows its state, its conductor and when it started', async ({ page }) => {
  const rows = await page.locator(`${MAIN_REGION} [data-cell="state"]`).count();
  expect(rows, 'no run row to inspect').toBeGreaterThan(0);
  await expect(page.locator(`${MAIN_REGION} [data-cell="conductor"]`)).toHaveCount(rows);
  await expect(page.locator(MAIN_REGION).getByText('started', { exact: true })).toHaveCount(rows);
});

Then('the run history comes before the handoff stream', async ({ page }) => {
  const precedes = await runHistoryHeading(page).evaluate(
    (heading, stream) => Boolean(heading.compareDocumentPosition(stream as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await page.locator(`${MAIN_REGION} details.collapsible`).elementHandle(),
  );
  expect(precedes, 'the run history does not come before the handoff stream').toBe(true);
});

Then('no run history is shown', async ({ page }) => {
  await expect(runHistoryHeading(page)).toHaveCount(0);
  await expect(page.locator(`${MAIN_REGION} [data-cell="state"]`)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Semantics: the state flow, the handoff times and the report source.
// ---------------------------------------------------------------------------

Then(
  'the workflow list marks the state of ticket {string} as its one current step',
  async ({ page }, identifier: string) => {
    const state = php(
      'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")' +
        `->loadByProperties(["identifier" => "${safe(identifier)}"]))) ? $e->get("state")->value : "");`,
    );
    const list = page.getByRole('list', { name: 'Workflow', exact: true });
    const current = list.locator('li[aria-current="step"]');
    await expect(current, 'the workflow list marks no single current step').toHaveCount(1);
    await expect(current).toContainText(state);
  },
);

Then('every handoff time is a time element with its exact date on hover', async ({ page }) => {
  const times = page.locator(`${MAIN_REGION} details.collapsible time`);
  const count = await times.count();
  expect(count, 'the handoff stream shows no time').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(times.nth(i)).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(times.nth(i)).toHaveAttribute('title', /\d{4}, \d{2}:\d{2}/);
  }
});

Then('every report row names its source before its counts', async ({ page }) => {
  const rows = page.locator('.summary-band__links .link-report-row');
  const count = await rows.count();
  expect(count, 'the band shows no report row').toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const source = rows.nth(i).locator('.link-report-row__title');
    await expect(source, 'a report row names no source').not.toHaveText('');
    const leads = await source.evaluate(
      (title, counts) => Boolean(counts && title.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING),
      await rows.nth(i).locator('.link-report-row__counts').elementHandle(),
    );
    expect(leads, 'the counts come before the source').toBe(true);
  }
});
