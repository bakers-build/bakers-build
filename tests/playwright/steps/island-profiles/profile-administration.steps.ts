import { Given, When, Then, test } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { expect, type Locator, type Page } from '@playwright/test';

// Recorded with playwright-cli against the actual config-entity forms. The
// pinned core EntityForm.fill() requires Field API widget definitions; these
// config entities have Form API controls instead, including dynamic placements.
// Keep their semantic controls here and retain the native BDD/auth fixtures.
const profilesPath = '/admin/structure/island/profiles';
const { After } = createBdd(test);
const states = new WeakMap<Page, { label: string; id: string; placements: Map<string, string> }>();

function state(page: Page) {
  const value = states.get(page);
  if (!value) throw new Error('Start a profile before editing its placements.');
  return value;
}

export function placement(page: Page, alias: string): Locator {
  const id = state(page).placements.get(alias);
  if (!id) throw new Error(`Unknown placement alias: ${alias}`);
  return page.locator('details').filter({
    has: page.getByRole('button', { name: `Placement ${id}`, exact: true }),
  }).last();
}

// Placement summaries, not the "Placement conditions" summary inside each one.
const placementSummary = /^Placement (?!conditions$)/;

async function placementIds(page: Page): Promise<string[]> {
  return (await page.getByRole('button', { name: placementSummary }).allTextContents())
    .map((label) => label.trim().replace(/^Placement /, '')).sort();
}

When('I open Apps administration', async ({ page }) => {
  await page.goto('/admin/structure/island/apps');
});

Then('bakers.build has its own app administration', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Edit bakers.build', exact: true }))
    .toHaveAttribute('href', /\/island\/apps\/bakers\/edit/);
});

When('I open Island Profiles administration', async ({ page }) => {
  await page.goto(profilesPath);
});

Then('bakers.build owns multiple island profiles', async ({ page }) => {
  const rows = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'bakers', exact: true }) });
  // These two named rows prove one app owns multiple profiles; additional
  // conditional route fixtures may legitimately belong to the same app.
  await expect(rows.filter({ has: page.getByRole('link', { name: 'Edit bakers.build gate', exact: true }) })).toHaveCount(1);
  await expect(rows.filter({ has: page.getByRole('link', { name: 'Edit bakers.build application shell', exact: true }) })).toHaveCount(1);
});

Given('I start a disabled fixture app profile using the Shell layout', async ({ page }) => {
  const id = `pw_profile_${Date.now()}`;
  states.set(page, { label: id, id, placements: new Map() });
  await page.goto(`${profilesPath}/add`);
  await page.getByRole('textbox', { name: /^Label(?: \*)?$/ }).fill(id);
  await page.getByRole('combobox', { name: /^App(?: \*)?$/ }).selectOption('browser_test');
  await page.getByRole('combobox', { name: /^Layout component(?: \*)?$/ }).selectOption('bb_theme:shell');
  await page.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
});

async function addPlacement(page: Page, alias: string, plugin: string) {
  const before = await placementIds(page);
  await page.getByRole('combobox', { name: 'Add placement', exact: true }).selectOption(plugin);
  await page.getByRole('button', { name: 'Add placement', exact: true }).click();
  await expect(page.getByRole('button', { name: placementSummary })).toHaveCount(before.length + 1);
  const added = (await placementIds(page)).filter((id) => !before.includes(id));
  expect(added).toHaveLength(1);
  state(page).placements.set(alias, added[0]);
}

When('I add a Menu placement named {string}', async ({ page }, alias: string) => {
  await addPlacement(page, alias, 'menu');
});

When('I add a component placement named {string}', async ({ page }, alias: string) => {
  await addPlacement(page, alias, 'ui_patterns_component');
});

When('I configure menu placement {string} with menu {string}, depth {int} and order {int}',
  async ({ page }, alias: string, menu: string, depth: number, order: number) => {
    const group = placement(page, alias);
    await group.getByRole('combobox', { name: /^Menu(?: \*)?$/ }).selectOption(menu);
    await group.getByRole('spinbutton', { name: 'Maximum depth', exact: true }).fill(String(depth));
    await group.getByRole('spinbutton', { name: 'Order', exact: true }).fill(String(order));
  });

Then('menu placement {string} retains menu {string}, depth {int} and order {int}',
  async ({ page }, alias: string, menu: string, depth: number, order: number) => {
    const group = placement(page, alias);
    await expect(group.getByRole('combobox', { name: /^Menu(?: \*)?$/ })).toHaveValue(menu);
    await expect(group.getByRole('spinbutton', { name: 'Maximum depth', exact: true })).toHaveValue(String(depth));
    await expect(group.getByRole('spinbutton', { name: 'Order', exact: true })).toHaveValue(String(order));
  });

When('I disable placement {string}', async ({ page }, alias: string) => {
  await placement(page, alias).getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
});

Then('placement {string} is disabled', async ({ page }, alias: string) => {
  await expect(placement(page, alias).getByRole('checkbox', { name: 'Enabled', exact: true })).not.toBeChecked();
});

When('I save and reopen the island profile', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === profilesPath);
  await page.getByRole('link', { name: `Edit ${state(page).label}`, exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Label(?: \*)?$/ })).toHaveValue(state(page).label);
  await expect(page.getByRole('checkbox', { name: 'Enabled', exact: true }).first()).not.toBeChecked();
});

Then('exactly the placements {string} retain their identities', async ({ page }, aliases: string) => {
  const expected = aliases.split(',').map((alias) => state(page).placements.get(alias));
  expect(await placementIds(page)).toEqual(expected.sort());
});

When('I change the island profile layout to Gate', async ({ page }) => {
  await page.getByRole('combobox', { name: /^Layout component(?: \*)?$/ }).selectOption('bb_theme:gate');
  await page.getByRole('button', { name: 'Update layout', exact: true }).click();
});

When('I attempt to save the island profile', async ({ page }) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});

Then('placement {string} must be reassigned or explicitly removed', async ({ page }, alias: string) => {
  await expect(page.getByRole('button', { name: 'Unassigned placements', exact: true })).toBeVisible();
  await expect(placement(page, alias).getByRole('combobox', { name: 'Reassign to slot', exact: true })).toBeVisible();
  await expect(page.locator('.messages--error, [role="alert"]')).toContainText(/reassigned|removed/);
  await expect(page).not.toHaveURL((url) => url.pathname === profilesPath);
});

When('I reassign placement {string} to slot {string}', async ({ page }, alias: string, slot: string) => {
  await placement(page, alias).getByRole('combobox', { name: 'Reassign to slot', exact: true }).selectOption(slot);
});

When('I move placement {string} to slot {string}', async ({ page }, alias: string, slot: string) => {
  await placement(page, alias).getByRole('combobox', { name: 'Slot', exact: true }).selectOption(slot);
});

When('I explicitly remove placement {string}', async ({ page }, alias: string) => {
  await placement(page, alias).getByRole('checkbox', { name: 'Remove placement', exact: true }).check();
});

Then('the island profile has no placements', async ({ page }) => {
  await expect(page.getByRole('button', { name: placementSummary })).toHaveCount(0);
});

Then('placement {string} belongs to slot {string}', async ({ page }, alias: string, slot: string) => {
  const slotName = slot.charAt(0).toUpperCase() + slot.slice(1);
  const group = page.locator('details').filter({ has: page.getByRole('button', { name: slotName, exact: true }) });
  await expect(group.getByRole('button', { name: `Placement ${state(page).placements.get(alias)}`, exact: true })).toBeVisible();
});

// Core condition forms sit in closed details: the collection, then one per
// condition plugin. Opening is idempotent so a reopened, configured (already
// open) group is not toggled shut.
async function openDetails(scope: Locator, summary: string): Promise<Locator> {
  const details = scope.locator('details').filter({
    has: scope.page().locator(':scope > summary', { hasText: new RegExp(`^\\s*${summary}`) }),
  }).first();
  if ((await details.getAttribute('open')) === null) {
    await details.locator(':scope > summary').click();
  }
  return details;
}

async function requestPath(scope: Locator, collection: string): Promise<Locator> {
  return openDetails(await openDetails(scope, collection), 'Request Path');
}

const profileScope = (page: Page) => page.locator('form');

When('I restrict the island profile to the pages {string}', async ({ page }, pages: string) => {
  const condition = await requestPath(profileScope(page), 'Profile conditions');
  await condition.getByRole('textbox', { name: 'Pages', exact: true }).fill(pages);
});

When('I hide placement {string} on the pages {string}', async ({ page }, alias: string, pages: string) => {
  const condition = await requestPath(placement(page, alias), 'Placement conditions');
  await condition.getByRole('textbox', { name: 'Pages', exact: true }).fill(pages);
  await condition.getByRole('checkbox', { name: 'Negate the condition', exact: true }).check();
});

Then('the island profile is restricted to the pages {string}', async ({ page }, pages: string) => {
  const condition = await requestPath(profileScope(page), 'Profile conditions');
  await expect(condition.getByRole('textbox', { name: 'Pages', exact: true })).toHaveValue(pages);
  await expect(condition.getByRole('checkbox', { name: 'Negate the condition', exact: true })).not.toBeChecked();
});

Then('placement {string} is hidden on the pages {string}', async ({ page }, alias: string, pages: string) => {
  const condition = await requestPath(placement(page, alias), 'Placement conditions');
  await expect(condition.getByRole('textbox', { name: 'Pages', exact: true })).toHaveValue(pages);
  await expect(condition.getByRole('checkbox', { name: 'Negate the condition', exact: true })).toBeChecked();
});

Then('placement {string} has no page condition', async ({ page }, alias: string) => {
  const condition = await requestPath(placement(page, alias), 'Placement conditions');
  await expect(condition.getByRole('textbox', { name: 'Pages', exact: true })).toHaveValue('');
});

After({ tags: '@feature:island-profiles' }, async ({ page }) => {
  const profile = states.get(page);
  if (!profile) return;
  // Remove only this scenario's UI-created, disabled profile. No live Drush
  // fixture writes; failed unsaved forms simply have no persisted entity.
  await page.goto(profilesPath);
  const edit = page.getByRole('link', { name: `Edit ${profile.label}`, exact: true });
  if (await edit.count()) {
    await edit.click();
    await page.getByRole('link', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === profilesPath);
  }
  states.delete(page);
});
