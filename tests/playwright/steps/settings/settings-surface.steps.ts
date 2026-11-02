// Direct visit vs boosted rail click must produce the same framed settings
// surface, and must not dump a second shell under the content island.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { php } from '../../support/drush';
import { CONTENT_ISLAND } from '../../support/shell';

function settingsPath(): string {
  const slug = php(
    '$storage = \\Drupal::entityTypeManager()->getStorage("bb_workspace");' +
      '$bakers = current($storage->loadByProperties(["slug" => "bakers"]));' +
      '$w = $bakers ?: current($storage->loadMultiple());' +
      'print $w ? $w->get("slug")->value : "";',
  );
  if (!slug) {
    throw new Error('No bb_workspace exists in this world.');
  }
  return `/${slug}/settings`;
}

When('I visit workspace settings by URL', async ({ page }) => {
  const response = await page.goto(settingsPath());
  expect(response?.status() ?? 0, 'Settings did not render').toBeLessThan(400);
  await page.waitForLoadState('networkidle');
});

Then('the settings screen is framed', async ({ page }) => {
  const shell = page.locator('[data-component-id="bb_theme:shell"]');
  await expect(shell.locator('[data-page-header]')).toHaveCount(1);
  await expect(shell.locator('[data-page-header] h1')).toBeVisible();
  const island = page.locator(CONTENT_ISLAND);
  await expect(island.locator('[data-component-id="bb_theme:zone"] form')).toHaveCount(1);
});
