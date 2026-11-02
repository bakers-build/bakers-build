import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Page, type Request } from '@playwright/test';
import { markDocument } from '../../support/shell';

// Inspected with playwright-cli on the recipe fixture. The outer attribute
// belongs to the caller; the inner IDs/wrappers come from the real renderer.
const instances = '[data-profile-instance]';
const islands = `${instances} [id^="island-profile_"]`;
const actions = new WeakMap<Page, { instance: string; requests: string[]; responseIds: string[]; ids: string[] }>();

Given('I open the repeated profile fixture', async ({ page }) => {
  await page.goto('/admin/structure/island/browser-fixture');
  await markDocument(page);
});

Then('both profile instances have distinct runtime identities and settings', async ({ page }) => {
  await expect(page.locator(instances)).toHaveCount(2);
  await expect(page.locator(islands)).toHaveCount(6);
  const ids = await page.locator(islands).evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(6);
  for (const instance of ['first', 'second']) {
    const scope = page.locator(`[data-profile-instance="${instance}"]`);
    await expect(scope.locator('[id$="-trigger"]')).toContainText('Original Trigger');
    await expect(scope.locator('[id$="-alpha"]')).toHaveText('Original Alpha');
    await expect(scope.locator('[id$="-beta"]')).toHaveText('Original Beta');
  }
});

When('I refresh counters in profile instance {string}', async ({ page }, instance: string) => {
  await page.locator(islands).evaluateAll((nodes) => {
    (window as unknown as Record<string, unknown>).__bakers423_instances = nodes.map((node) => ({ id: node.id, node }));
  });
  const ids = await page.locator(islands).evaluateAll((nodes) => nodes.map((node) => node.id).sort());
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (['document', 'xhr', 'fetch'].includes(request.resourceType())) requests.push(request.resourceType());
  };
  const scope = page.locator(`[data-profile-instance="${instance}"]`);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URLSearchParams(response.request().postData() ?? '').get('_island_action') === 'refresh');
  page.on('request', listener);
  try {
    await scope.getByRole('link', { name: 'Refresh counters', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const responseIds = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      return [...document.querySelectorAll('[id^="island-profile_"]')].map((node) => node.id).sort();
    }, await response.text());
    // The second action has the same text as the first. Await replacement of
    // the actual trigger node, so old text cannot satisfy an unfinished request.
    await expect.poll(() => scope.locator('[id$="-trigger"]').evaluate((node) => {
      const previous = (window as unknown as Record<string, unknown>).__bakers423_instances as { id: string; node: Element }[];
      return previous.find(({ id }) => id === node.id)?.node !== node;
    })).toBe(true);
    actions.set(page, { instance, requests, responseIds, ids });
  } finally {
    page.off('request', listener);
  }
});

export async function assertRefreshedPlacements(page: Page, target: string) {
  const action = actions.get(page);
  if (!action) throw new Error('Trigger an instance event before checking its response.');
  const scope = page.locator(`[data-profile-instance="${action.instance}"]`);
  const expectedIds = await scope.locator(`[id$="-trigger"], [id$="-${target}"]`)
    .evaluateAll((nodes) => nodes.map((node) => node.id).sort());
  expect(expectedIds).toHaveLength(2);
  expect(action.responseIds).toEqual(expectedIds);
  expect(action.requests).toEqual(['xhr']);
  await expect.poll(() => page.evaluate(() => {
    const previous = (window as unknown as Record<string, unknown>).__bakers423_instances as { id: string; node: Element }[];
    return previous.filter(({ id, node }) => document.getElementById(id) !== node).map(({ id }) => id).sort();
  })).toEqual(expectedIds);
  expect(await page.locator(islands).evaluateAll((nodes) => nodes.map((node) => node.id).sort())).toEqual(action.ids);
  return { scope, instance: action.instance };
}

Then('exactly its trigger and Alpha placements were refreshed in one request', async ({ page }) => {
  const { scope, instance } = await assertRefreshedPlacements(page, 'alpha');
  await expect(scope.locator('[id$="-alpha"]')).toHaveText('Refreshed Alpha');
  await expect(scope.locator('[id$="-beta"]')).toHaveText('Original Beta');
  const other = instance === 'first' ? 'second' : 'first';
  await expect(page.locator(`[data-profile-instance="${other}"] [id$="-alpha"]`)).toHaveText('Original Alpha');
});
