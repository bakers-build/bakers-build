// Webhooks: the Webhooks tab of a project, a group and the workspace, the
// add form with its one-time secret, and the webhook's Settings and Delete.
// `I click the tab`, `the page shows`, `the page heading is` and
// `the page header offers the action` come from support/steps/shell.steps.ts.
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { CONTENT_ISLAND, PAGE_HEADER_ISLAND, markDocument } from '../../support/shell';

const { When, Then, After } = createBdd(test);

type Scope = 'project' | 'group' | 'workspace';

/** The secret each page was shown, to prove it is not shown again. */
const secrets = new WeakMap<Page, string>();

const STORAGE: Record<Scope, string> = { project: 'bb_project', group: 'bb_group', workspace: 'bb_workspace' };

/** The property a scope is named by in a scenario: a workspace by its slug. */
const KEY: Record<Scope, string> = { project: 'name', group: 'name', workspace: 'slug' };

/** The address of a scope's Webhooks tab, resolved from its name or slug. */
function tabPath(scope: Scope, label: string): string {
  const path = php(
    `$e = current(\\Drupal::entityTypeManager()->getStorage("${STORAGE[scope]}")->loadByProperties(["${KEY[scope]}" => "${safe(label)}"]));` +
      ' if (!$e) { print ""; return; }' +
      ` $ws = "${scope}" === "workspace" ? $e : ("${scope}" === "group" ? $e->get("workspace_id")->entity : $e->get("group_id")->entity->get("workspace_id")->entity);` +
      ` $p = ["bb_workspace" => $ws->getSlug()] + ("${scope}" === "workspace" ? [] : $e->toUrl()->getRouteParameters());` +
      ` print \\Drupal\\Core\\Url::fromRoute("view.bb_webhooks.${scope}_list", $p)->toString();`,
  );
  if (!path) {
    throw new Error(`No ${scope} named "${label}" exists in the seeded world.`);
  }
  return path;
}

// Scenario webhooks are named e2e-*: remove what a failed run left behind.
After({ tags: '@feature:webhooks' }, async () => {
  php('foreach (\\Drupal::entityTypeManager()->getStorage("bb_webhook")->loadMultiple() as $w) { if (str_starts_with($w->label(), "e2e-")) { $w->delete(); } } print "ok";');
});

When('I open the Webhooks tab of the {word} {string}', async ({ page }, scope: Scope, label: string) => {
  const response = await page.goto(tabPath(scope, label));
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Webhooks', exact: true })).toHaveAttribute('aria-current', /page|true/);
  await markDocument(page);
});

When('I visit the Webhooks tab of the {word} {string} by its address', async ({ page }, scope: Scope, label: string) => {
  await page.goto(tabPath(scope, label));
});

When('I create the webhook {string} for {string}', async ({ page }, name: string, url: string) => {
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Create webhook', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});

Then('the page shows the signing secret once', async ({ page }) => {
  const message = page.getByText(/Signing secret: [0-9a-f]{64}\./).first();
  await expect(message).toBeVisible();
  const secret = /[0-9a-f]{64}/.exec((await message.textContent()) ?? '')?.[0];
  expect(secret).toBeTruthy();
  secrets.set(page, secret as string);
});

When('I open the webhook {string}', async ({ page }, name: string) => {
  await page.locator(CONTENT_ISLAND).getByRole('link', { name, exact: true }).click();
  await expect(page.locator('h1').filter({ hasText: name })).toBeVisible();
});

When('I save the webhook with the URL {string} and Enabled unticked', async ({ page }, url: string) => {
  await page.getByLabel('URL', { exact: true }).fill(url);
  await page.getByLabel('Enabled', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved\./).first()).toBeVisible();
});

Then('the signing secret is not shown', async ({ page }) => {
  const secret = secrets.get(page);
  expect(secret, 'No secret was shown in this scenario.').toBeTruthy();
  await expect(page.getByText(secret as string)).toHaveCount(0);
});

When('I delete the webhook', async ({ page }) => {
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('button', { name: /^(Delete|Confirm)$/ }).click();
  await expect(page.getByText(/^Deleted .+\.$/).first()).toBeVisible();
});
