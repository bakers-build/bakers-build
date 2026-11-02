import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Page, type Request } from '@playwright/test';
import { markDocument } from '../../support/shell';

// Recorded on the recipe route with playwright-cli. These suffixes are its
// persisted placement IDs; the runtime host encoding is deliberately omitted.
// NOTE: Task 9/10's rebuild (BB-504) deleted `.shell__sidebar` along with
// every other BEM class in `shell.twig`; the sidebar wrapper is now a bare,
// unmarked `<div class="shrink-0">`. It is still reachable: it is the only
// element directly under the shell root whose own direct child is the placed
// island (the main-column wrapper is also a direct child of the root, but the
// island there sits one level deeper, inside `<main>`).
// A function rather than a plain string: each alternative needs its OWN copy of a suffix
// filter appended, because appending a suffix to the joined comma-list as a plain template
// literal would attach it only to the LAST alternative and leave the first unfiltered.
function placements(suffix = ''): string {
  return [
    `[data-component-id="bb_theme:shell"] > div > [id^="island-profile_"]${suffix}`,
    `[data-component-id="bb_theme:shell"] main > [id^="island-profile_"]${suffix}`,
  ].join(', ');
}
const navigations = new WeakMap<Page, { ids: string[]; expected: string[]; requests: string[] }>();

Given('I open the standard menu fixture', async ({ page }) => {
  await page.goto('/island-browser/menu/first');
  await markDocument(page);
});

Then('the standard menus retain their configured depths', async ({ page }) => {
  await expect(page.locator(placements())).toHaveCount(3);
  const shallow = page.locator(placements('[id$="-shallow"]'));
  const deep = page.locator(placements('[id$="-deep"]'));
  for (const menu of [shallow, deep]) {
    await expect(menu.getByRole('link', { name: 'First menu page', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Second menu page', exact: true })).toBeVisible();
  }
  // The deep placement is the positive control for the shallow one's absence.
  await expect(deep.getByRole('link', { name: 'Nested menu entry', exact: true })).toBeVisible();
  await expect(shallow.getByRole('link', { name: 'Nested menu entry', exact: true })).toHaveCount(0);
  await expect(shallow.getByRole('link')).toHaveCount(2);
  await expect(deep.getByRole('link')).toHaveCount(3);
});

Then('the menu controller shows {string}', async ({ page }, name: string) => {
  await expect(page.locator('[data-component-id="bb_theme:shell"] main [data-menu-page]')).toHaveAttribute('data-menu-page', name);
  await expect(page.locator('[data-component-id="bb_theme:shell"] main [data-menu-page]')).toHaveText(`Controller result: ${name}`);
});

When('I follow the {string} standard menu to {string}', async ({ page }, menu: string, destination: string) => {
  await page.locator(placements()).evaluateAll((nodes) => {
    (window as unknown as Record<string, unknown>).__bakers423_menu = nodes.map((node) => ({ id: node.id, node }));
  });
  const ids = await page.locator(placements()).evaluateAll((nodes) => nodes.map((node) => node.id).sort());
  const expected = await page.locator(
    [placements(`[id$="-${menu}"]`), placements('[id$="-content"]')].join(', '),
  ).evaluateAll((nodes) => nodes.map((node) => node.id).sort());
  expect(expected).toHaveLength(2);
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (['document', 'xhr', 'fetch'].includes(request.resourceType())) requests.push(request.resourceType());
  };
  const title = `${destination.charAt(0).toUpperCase()}${destination.slice(1)} menu page`;
  page.on('request', listener);
  try {
    await page.locator(placements(`[id$="-${menu}"]`)).getByRole('link', { name: title, exact: true }).click();
    await expect(page.locator('[data-component-id="bb_theme:shell"] main [data-menu-page]')).toHaveAttribute('data-menu-page', destination);
    await expect(page.locator('[data-component-id="bb_theme:shell"] main [data-menu-page]')).toHaveText(`Controller result: ${destination}`);
    await expect(page).toHaveURL((url) => url.pathname === `/island-browser/menu/${destination}`);
  } finally {
    page.off('request', listener);
  }
  navigations.set(page, { ids, expected, requests });
});

Then('exactly the clicked menu and controller were replaced in one request', async ({ page }) => {
  const navigation = navigations.get(page);
  if (!navigation) throw new Error('Follow a standard menu before checking its targets.');
  expect(navigation.requests).toEqual(['xhr']);
  await expect.poll(() => page.evaluate(() => {
    const original = (window as unknown as Record<string, unknown>).__bakers423_menu as { id: string; node: Element }[];
    return original.filter(({ id, node }) => document.getElementById(id) !== node).map(({ id }) => id).sort();
  })).toEqual(navigation.expected);
  expect(await page.locator(placements()).evaluateAll((nodes) => nodes.map((node) => node.id).sort())).toEqual(navigation.ids);
});
