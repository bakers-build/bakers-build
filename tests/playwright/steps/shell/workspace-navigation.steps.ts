import { Then, When } from '../../bdd.fixtures';
import { expect, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { RAIL_ISLAND } from '../../support/shell';

const railLinks = (page: Page) => page.locator(RAIL_ISLAND).getByRole('navigation').getByRole('link');

function workspaceName(slug: string): string {
  if (!/^[a-z]+$/.test(slug)) throw new Error('Expected a fixture workspace slug.');
  return php(`print current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]))->label();`);
}

When('I open My work in workspace {string}', async ({ page }, slug: string) => {
  expect((await page.goto(`/${slug}/tickets`))?.status()).toBe(200);
});

When('I switch to workspace {string} with the workspace switcher', async ({ page }, slug: string) => {
  await page.locator('[data-account-switcher-toggle="workspace"]').click();
  await page.locator('[role="menu"] a[role="menuitem"]').filter({ hasText: workspaceName(slug) }).first().click();
  await expect(page).toHaveURL(new RegExp(`^[^?#]*//[^/]+/${slug}(/|$)`));
});

Then('every rail link points into workspace {string}', async ({ page }, slug: string) => {
  await expect(railLinks(page).filter({ hasText: 'My work' })).toHaveAttribute('href', `/${slug}/tickets`);
  const hrefs = await railLinks(page).evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    expect(href, `Rail link ${href}`).toMatch(new RegExp(`^/${slug}/`));
  }
});
