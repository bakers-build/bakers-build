// BB-396 — the team screen as the island reference surface.
//
// Every functional assertion about this surface is a browser assertion, by the
// human's decision on 2026-08-30: "alle functional als playwright nicht in
// drupal". That agrees with WORKFLOW.md, which already states that a
// BrowserTestBase is not an acceptable substitute for a browser suite.
//
// THE SECOND CLICK IS THE ASSERTION. BB-408's first delivery applied the
// boost declaration at the caller, so every swapped fragment came back bare and
// a boosted navigation worked exactly once per page load. Measured then as
// `rail attrs AFTER the click: []`. A one-click scenario cannot see it, which
// is why `the document was not reloaded` is asserted after each of two clicks
// rather than once at the end.
import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MEMBERS_ISLAND, RAIL_ISLAND, uidOf } from '../../support/shell';
import { pickerTrigger, waitForPickerBehaviour } from '../../support/picker';
import { ADD_DIALOG, addMemberTrigger, openAddMemberDialog } from '../../support/add-member-dialog';

// BB-484 — the Overview body, which is the `full` view mode's own markup and
// NOT a controller hull. There is deliberately no `[data-bakers-tab-body]` here:
// once the body became the entity view, the controller that rendered it was
// only reimplementing core's `_entity_view` route default, so it went away and
// the marker went with it. The display's top-level `canvas` component (the
// Activities feed beside the Identity and Projects cards) is the hull now,
// and it is what this step addresses.
//
// Asserted by the Projects card's heading and the project it lists rather
// than a bare "not empty", so a regression that left SOME body behind — any
// body — would not satisfy this step by accident.
const OVERVIEW_BODY = '[data-component-id="bb_theme:canvas"]';

// Spec D3's deliberate negative: the rail does NOT ride along. Asserted by
// identity of the DOM node rather than by its presence — a re-rendered rail is
// still "present", so presence cannot tell the two apart. A node that survived
// the swap keeps a property set on it before the click; a replaced one does not.
async function railNodeSurvived(page: Page): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(id);
    return el !== null && (el as unknown as Record<string, unknown>).__bakers396_rail === true;
  }, RAIL_ISLAND);
}

Then('the shell rail is still present', async ({ page }) => {
  await expect(page.locator(RAIL_ISLAND)).toBeAttached();
});

Then('the tab body shows the Projects relation', async ({ page }) => {
  const body = page.locator(OVERVIEW_BODY);
  await expect(body).toHaveCount(1);
  await expect(body.getByText('Projects', { exact: true }).first()).toBeVisible();
  const text = (await body.innerText()).trim();
  expect(text).not.toBe('');
  expect(text).toContain('bakers.build Platform');
});

// The other half of the same claim, and the reason it is a step of its own:
// the step above would still pass if a controller hull had crept back AROUND
// the zone. This one fails in that case, which is what pins the rollback in
// the browser rather than only in the Kernel test.
Then('the Overview body carries no controller hull', async ({ page }) => {
  await expect(page.locator('[data-bakers-tab-body]')).toHaveCount(0);
});

Then('exactly one tab body is present in the document', async ({ page }) => {
  const path = new URL(page.url()).pathname;
  if (path.endsWith('/tickets')) {
    await expect(page.locator('form[id^="views-exposed-form-tickets-team-tickets"]')).toHaveCount(1);
    await expect(page.locator('[data-component-id="bb_theme:list"]')).toHaveCount(1);
    return;
  }
  // `Runs` is a native Views page (BB-454), shipped empty like `Tickets` — no
  // controller wraps it in `[data-bakers-tab-body]`, and it declares no fields,
  // so its own body carries no addressable node beyond the view's own title
  // heading — measured: with rows present the page still renders none of them
  // visibly, because the view ships with no field to draw one. The title is
  // the one stable, always-present marker, whether or not the seeded world
  // carries rows for this team.
  if (path.endsWith('/runs')) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    return;
  }
  await expect(page.locator('[data-bakers-tab-body]')).toHaveCount(1);
});

Then('the rail was not part of the swap', async ({ page }) => {
  expect(await railNodeSurvived(page)).toBe(true);
});

// The failing side of the identity detector, and a real property of the surface
// rather than a contrivance: a rail click updates the rail out of band, so the
// rail node IS replaced. Driving the detector to `false` here is what makes the
// `was not part of the swap` assertions above trustworthy — otherwise a detector
// that always answered "survived" would pass them all.
Then('the rail was part of the swap', async ({ page }) => {
  expect(await railNodeSurvived(page)).toBe(false);
});

/**
 * How many members the roster shows: the roster list's items, direct
 * children only, so a role picker's own option rows are never counted.
 */
Then('the members list has {int} rows', async ({ page }, count: number) => {
  await expect(page.locator(`${MEMBERS_ISLAND} ul[role="list"] > li[data-list-item]`)).toHaveCount(count);
});

// One step for the whole affordance, because a scenario that filled the field
// and clicked separately would be asserting the widget rather than the island.
// The page header's Add member opens the dialog; pick the person's row (its
// value is the uid), keep the role, press Add member. The dialog closes and the
// members island re-renders in place, so the step waits for the new row.
When('I add the member {string}', async ({ page }, value: string) => {
  const dialog = await openAddMemberDialog(page);
  const trigger = pickerTrigger(page, ADD_DIALOG, 'Member');
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await dialog.locator(`[role="option"][data-value="${uidOf(value)}"]`).click();
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/members/add'),
    { timeout: 15000 },
  );
  await dialog.getByRole('button', { name: 'Add member', exact: true }).click();
  await answered;
  await expect(page.locator(ADD_DIALOG), 'the add dialog did not close').toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(`${MEMBERS_ISLAND} #members-role-${uidOf(value)}`)).toBeAttached({ timeout: 15000 });
  // The flow ends when focus is back on Add member; a next step must not race it.
  await expect(addMemberTrigger(page)).toBeFocused({ timeout: 15000 });
});

/**
 * Removes an account's membership of a team, if it has one.
 *
 * THE ADD SCENARIOS WOULD OTHERWISE BE SINGLE-USE. They assert absolute row
 * counts, and adding a member changes the world — so a second run starts at
 * four rows and every count fails while the mechanism works perfectly. That is
 * the shape of failure that gets a suite deleted: it looks like a regression
 * and is not one. Each scenario therefore states the precondition it needs
 * instead of inheriting whatever the last run left behind.
 *
 * THE ACCOUNT IS A SEED USERNAME (or the Label (id) form the add step types).
 * The id is what this step keys on. uid 1 is called `admin` on a stock install
 * but `placeholder-for-uid-1` on a `--provider recipe-test` world, so a lookup
 * that assumed uid 1 matched nothing there, the stale membership survived and
 * the next add scenario counted four rows where it expects three.
 */
Given('the team {string} has no member {string}', async ({}, team: string, account: string) => {
  const safeTeam = team.replace(/["'\\$]/g, '');
  const uid = uidOf(account);
  const php = [
    'foreach (\\Drupal::entityTypeManager()->getStorage("bb_team")',
    `->loadByProperties(["name" => "${safeTeam}"]) as $t) {`,
    '$ids = \\Drupal::entityTypeManager()->getStorage("og_membership")->getQuery()',
    '->accessCheck(FALSE)->condition("entity_type", "bb_team")',
    `->condition("entity_id", $t->id())->condition("uid", ${uid})->execute();`,
    'foreach (\\Drupal::entityTypeManager()->getStorage("og_membership")',
    '->loadMultiple($ids) as $m) { $m->delete(); } }',
  ].join(' ');
  // Both the team and the account come from the scenario's own step
  // arguments, and every caller of this step lives in team-islands.feature —
  // no other feature's fixture is touched.
  Drush.exec(`ev '${php}'`);
});
