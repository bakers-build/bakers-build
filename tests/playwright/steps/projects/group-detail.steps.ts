// Group detail and settings: the Groups listing links into a group, the
// detail's read-only Properties card shows the owner and workspace, and the
// Settings tab carries the `settings` form mode. Card steps shared with other
// details live in support/steps/detail-cards.steps.ts.
//
// ONLY THE STEPS NOT PROVIDED ELSEWHERE. `I visit the {string} listing` comes
// from projects-list.steps.ts; `I click the tab`, `the address ends with`,
// `the document was not reloaded` and `the page heading is` from
// support/steps/shell.steps.ts; the sign-in steps from support/steps.
import { When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { CONTENT_ISLAND, PAGE_HEADER_ISLAND, markDocument } from '../../support/shell';
import { cardRow } from '../../support/detail-cards';

type Group = { url: string; owner: string; workspace: string };

/** The group in context, set by the step that opened it. */
let current: Group | null = null;

/** Resolves a group by label: its public URL, owner and workspace labels. */
function group(label: string): Group {
  const raw = php(
    '$g = current(\\Drupal::entityTypeManager()->getStorage("bb_group")' +
      `->loadByProperties(["name" => "${safe(label)}"]));` +
      ' print $g ? json_encode(["url" => $g->toUrl()->toString(),' +
      ' "owner" => $g->get("owner_user_id")->entity->getDisplayName(),' +
      ' "workspace" => $g->get("workspace_id")->entity->label()]) : "";',
  );
  if (!raw) {
    throw new Error(`No bb_group named "${label}" exists in the seeded world.`);
  }
  return JSON.parse(raw) as Group;
}

function requireGroup(): Group {
  if (current === null) {
    throw new Error('No group is in context — open or visit a group first.');
  }
  return current;
}

When('I click the group {string} in the listing', async ({ page }, label: string) => {
  current = group(label);
  await page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).getByRole('link', { name: label, exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(current.url);
  // The listing-to-detail hop is not under test for document survival; the
  // tab clicks that follow are, so the mark starts here.
  await markDocument(page);
});

When('I visit the group {string}', async ({ page }, label: string) => {
  current = group(label);
  const response = await page.goto(current.url);
  expect(response?.status() ?? 0, `The group "${label}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the address is the detail of the group {string}', async ({ page }, label: string) => {
  expect(new URL(page.url()).pathname).toBe(group(label).url);
});

Then('the group detail shows its owner and workspace', async ({ page }) => {
  const { owner, workspace } = requireGroup();
  await expect(cardRow(page, 'Properties', 'Owner')).toContainText(owner, { timeout: 10000 });
  await expect(cardRow(page, 'Properties', 'Workspace')).toContainText(workspace);
});

Then('the settings form edits only the name {string}', async ({ page }, name: string) => {
  const form = page.locator(`${CONTENT_ISLAND} form`).filter({ has: page.getByRole('textbox', { name: 'Name' }) });
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue(name, { timeout: 10000 });
  // The default edit form exposed these; the settings form mode hides them.
  await expect(form.getByRole('combobox', { name: /Owner|Workspace/ })).toHaveCount(0);
  await expect(form.getByRole('textbox', { name: /Owner|Workspace/ })).toHaveCount(0);
});

Then('the page heading is not the workspace label', async ({ page }) => {
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toHaveText(requireGroup().workspace);
});

Then('there is no tab {string}', async ({ page }, tab: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: tab, exact: true })).toHaveCount(0);
});

Then('the settings of the group {string} are refused', async ({ page }, label: string) => {
  const response = await page.goto(`${group(label).url}/settings`);
  expect(response?.status()).toBe(403);
});
