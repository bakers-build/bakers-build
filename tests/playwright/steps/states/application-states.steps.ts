import type { Page, Route } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../../support/drush';

const { Given, When, Then, After } = createBdd(test);

// Both seeded bakeries carry projects and groups, so an empty listing needs a
// workspace of its own: slug `empty`, one throwaway member, removed afterwards.
const EMPTY_SLUG = 'empty';
const removeEmptyWorkspace = () => php(
  `$etm = \\Drupal::entityTypeManager(); foreach ($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${EMPTY_SLUG}"]) as $w) { $w->delete(); }` +
  ` foreach ($etm->getStorage("user")->loadByProperties(["name" => "${EMPTY_SLUG}-member"]) as $u) { $u->delete(); }`,
);

Given('I am signed in as a member of an empty workspace', async ({ page, authProvider }) => {
  removeEmptyWorkspace();
  const uid = php(
    `$etm = \\Drupal::entityTypeManager(); $u = $etm->getStorage("user")->create(["name" => "${EMPTY_SLUG}-member", "status" => 1, "field_onboarding_completed" => TRUE]); $u->save();` +
    ` $w = $etm->getStorage("bb_workspace")->create(["name" => "Empty bakery", "slug" => "${EMPTY_SLUG}", "owner_user_id" => 1]); $w->save();` +
    ' \\Drupal\\og\\Og::createMembership($w, $u)->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-contributor")])->save(); print $u->id();',
  ).trim();
  expect(Number(uid)).toBeGreaterThan(0);
  await authProvider.login(page, uid);
});

After({ tags: '@feature:application-states' }, async () => {
  removeEmptyWorkspace();
});

Then('the error screen is {int} with the {string} signpost', async ({ page }, status: number, icon: string) => {
  const title = status === 403 ? '403 — Access denied' : '404 — Page not found';
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText(title);
  await expect(page.locator('[data-component-id="bb_theme:gate"]')).toBeVisible();
  await expect(page.locator('[data-component-id="bb_theme:shell"]')).toHaveCount(0);
  const state = page.locator('[data-component-id="bb_theme:empty-state"]');
  await expect(state).toContainText(status === 403
    ? "You don't have permission to open this page."
    : "We couldn't find this page. It may have moved or the address may be incorrect.");
  const svg = state.locator('svg');
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  const href = await svg.locator('use').getAttribute('href');
  expect(href).toMatch(new RegExp(`#${icon}$`));
  const sprite = await page.request.get(new URL(href!.split('#')[0], page.url()).href);
  expect(sprite.ok()).toBeTruthy();
  expect(await sprite.text()).toContain(`id="${icon}"`);
  expect(await svg.evaluate(el => el.getBoundingClientRect().width)).toBe(64);
  await expect(page.locator('body')).not.toContainText('Exception');
});

Then('the recovery link is {string} to {string}', async ({ page }, label: string, path: string) => {
  const link = page.getByRole('link', { name: label, exact: true });
  await expect(link).toHaveAttribute('href', path);
  await expect(link).toHaveAttribute('data-hx-boost', 'false');
  await link.focus();
  await expect(link).toBeFocused();
});

When('I follow the error recovery link twice from {string}', async ({ page }, missing: string) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.goto(missing);
    const navigation = page.waitForNavigation();
    const link = page.getByRole('link', { name: 'Go to home', exact: true });
    await link.focus();
    await link.press('Enter');
    await navigation;
    expect(new URL(page.url()).pathname).toBe('/home');
  }
});

let protectedResponse: { status: number; location: string };
When('I request a protected ticket without following redirects', async ({ page, apiClient }) => {
  const response = await page.request.get(apiClient.resolve('/bakers/ticket/{ticket.home}'), { maxRedirects: 0 });
  protectedResponse = { status: response.status(), location: response.headers().location ?? '' };
});
Then('the protected response is an authentication redirect', async () => {
  expect(protectedResponse.status).toBe(302);
  expect(protectedResponse.location).toContain('/user/login');
});

Then('the API error remains JSON', async ({ apiClient }) => {
  expect(apiClient.response?.headers()['content-type']).toContain('application/vnd.api+json');
  const body = await apiClient.response!.json();
  expect(body).toHaveProperty('errors');
  expect(JSON.stringify(body)).not.toContain('<svg');
});

Then('a delayed failed project filter keeps its populated rows', async ({ page }) => {
  const list = page.locator('main .views-element-container');
  const rows = list.locator('li[data-list-item]');
  const emptyState = list.locator('[data-component-id="bb_theme:empty-state"]');
  await expect(emptyState).toHaveCount(0);
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  let pending: Route | undefined;
  await page.route('**/bakers/projects?**', route => { pending = route; });
  await page.locator('input[name="title"]').fill('no-such-delayed-project');
  await page.locator('input[name="title"]').press('Enter');
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(rows).toHaveCount(count);
  await expect(emptyState).toHaveCount(0);
  const response = page.waitForResponse(res => res.status() === 503);
  await pending!.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
  await response;
  await expect(page.locator('.htmx-request')).toHaveCount(0);
  await expect(rows).toHaveCount(count);
  await expect(emptyState).toHaveCount(0);
});

/** The listing renders no rows and one shared inbox empty state. */
async function expectInboxEmptyState(page: Page, message: string): Promise<void> {
  const list = page.locator('main .views-element-container');
  await expect(list.locator('li[data-list-item]')).toHaveCount(0);
  const state = list.locator('[data-component-id="bb_theme:empty-state"]');
  await expect(state).toHaveCount(1);
  await expect(state).toHaveText(message);
  const svg = state.locator('svg');
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('aria-hidden', 'true');
  await expect(svg.locator('use')).toHaveAttribute('href', /#inbox$/);
}

Then('the listing has one small inbox beside {string}', async ({ page }, message: string) => {
  await expectInboxEmptyState(page, message);
  await expect(page.locator('input[name="title"]')).toBeVisible();
});

Then('the listing shows the empty state {string}', async ({ page }, message: string) => {
  await expectInboxEmptyState(page, message);
});

Then('the populated listing has no empty state', async ({ page }) => {
  const list = page.locator('main .views-element-container');
  expect(await list.locator('li[data-list-item]').count()).toBeGreaterThan(0);
  await expect(list.locator('[data-component-id="bb_theme:empty-state"]')).toHaveCount(0);
});
