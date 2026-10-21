// The collapse toggle must remain clickable after the first click. Presence
// is not the assertion: the broken rail leaves the button in the DOM and
// reported visible, with the workspace avatar swallowing the hit test.
import { When, Then } from '@key-tec/playwright-core/bdd';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';

const RAIL = '[data-sidebar]';
const TOGGLE = '[data-sidebar-toggle]';
const SWITCHER = '[data-account-switcher]';

function workspaceScreenPath(): string {
  const slug = php(
    '$storage = \\Drupal::entityTypeManager()->getStorage("bb_workspace");' +
      '$bakers = current($storage->loadByProperties(["slug" => "bakers"]));' +
      '$w = $bakers ?: current($storage->loadMultiple());' +
      'print $w ? $w->get("slug")->value : "";',
  );
  if (!slug) {
    throw new Error('No bb_workspace exists in this world.');
  }
  return `/${slug}/tickets`;
}

function rail(page: Page): Locator {
  return page.locator(RAIL).first();
}

function toggle(page: Page): Locator {
  return page.locator(TOGGLE).first();
}

When('I open a themed workspace screen with the rail expanded', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('bakers.sidebar');
      localStorage.removeItem('_x_bakers.sidebar');
    } catch {
      // Private mode can throw; the server-rendered rail is expanded anyway.
    }
  });
  const response = await page.goto(workspaceScreenPath());
  expect(response?.status() ?? 0, 'The workspace screen did not render').toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await expect(rail(page), 'The application shell did not render a navigation rail').toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
});

When('I click the collapsed rail destination {string}', async ({ page }, label: string) => {
  // Labels are display:none on the collapsed rail; the icon link stays the hit target.
  await page.locator(`${RAIL} [data-navigation] a`).filter({ hasText: label }).click({ force: true });
});

When('I click the sidebar collapse toggle', async ({ page }) => {
  // No { force: true }: Playwright's actionability check is the mechanism.
  // A covered toggle times out here, which is the defect.
  await toggle(page).click({ timeout: 8000 });
});

Then('the navigation rail is collapsed', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-sidebar-collapsed', '');
  const width = await rail(page).evaluate((el) => parseFloat(getComputedStyle(el).width));
  expect(width, 'Collapsed rail is still full width').toBeLessThan(80);
});

Then('the navigation rail is expanded', async ({ page }) => {
  await expect(page.locator('html')).not.toHaveAttribute('data-sidebar-collapsed');
  const width = await rail(page).evaluate((el) => parseFloat(getComputedStyle(el).width));
  expect(width, 'Expanded rail is still the collapsed width').toBeGreaterThan(120);
});

Then('the collapsed rail keeps its navigation icons', async ({ page }) => {
  const icons = page.locator(`${RAIL} [data-navigation] a svg, ${RAIL} [data-navigation] a [data-person-mark]`);
  await expect(icons.first(), 'The collapsed rail has no navigation icon or team mark').toBeVisible();
  expect(
    await icons.count(),
    'The collapsed rail must keep more than one destination as an icon or mark',
  ).toBeGreaterThan(1);
});

Then('the collapsed rail hides its disclosure chevrons', async ({ page }) => {
  const hidden = page.locator(`${RAIL} [data-collapse-hidden]`);
  expect(await hidden.count(), 'The collapsed rail has no data-collapse-hidden surfaces').toBeGreaterThan(0);
  for (const el of await hidden.all()) {
    await expect(el).toBeHidden();
  }
});

Then('the workspace switcher is independently clickable', async ({ page }) => {
  const switcher = page.locator(`${SWITCHER} [data-person-mark]`).first();
  await expect(switcher).toBeVisible();
  const toggleBox = await toggle(page).boundingBox();
  const switcherBox = await switcher.boundingBox();
  expect(toggleBox, 'The collapse toggle has no box').not.toBeNull();
  expect(switcherBox, 'The workspace switcher has no box').not.toBeNull();
  const overlap = !(
    switcherBox!.x + switcherBox!.width <= toggleBox!.x ||
    toggleBox!.x + toggleBox!.width <= switcherBox!.x ||
    switcherBox!.y + switcherBox!.height <= toggleBox!.y ||
    toggleBox!.y + toggleBox!.height <= switcherBox!.y
  );
  expect(overlap, 'The workspace switcher and the collapse toggle overlap').toBe(false);

  const toggleHit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el instanceof Element && el.closest('[data-sidebar-toggle]') !== null;
    },
    { x: toggleBox!.x + toggleBox!.width / 2, y: toggleBox!.y + toggleBox!.height / 2 },
  );
  expect(toggleHit, 'The collapse toggle is covered at its centre').toBe(true);

  const switcherHit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el instanceof Element && el.closest('[data-account-switcher]') !== null;
    },
    { x: switcherBox!.x + switcherBox!.width / 2, y: switcherBox!.y + switcherBox!.height / 2 },
  );
  expect(switcherHit, 'The workspace switcher is covered at its centre').toBe(true);
});

Then('the collapsed rail entry {string} shows an icon', async ({ page }, label: string) => {
  await expect(page.locator(`${RAIL} [data-navigation]`).getByRole('link', { name: label }).locator('svg')).toBeVisible();
});

Then('the rail heading {string} shows the {string} icon', async ({ page }, label: string, icon: string) => {
  const heading = page.locator(`${RAIL} [data-navigation]`).getByRole('button', { name: label });
  await expect(heading, `Rail heading "${label}" is missing`).toBeVisible();
  await expect(
    heading.locator(`use[href$="#${icon}"]`),
    `Rail heading "${label}" does not use icon "${icon}"`,
  ).toBeVisible();
});
