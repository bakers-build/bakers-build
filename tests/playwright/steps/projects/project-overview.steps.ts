// Project Overview: the canonical `full` view mode (description, Activities,
// Properties and Epics inspector). Count figures belong on the Board.
// `I visit the {string} listing` comes from projects-list.steps.ts;
// tab/heading/document steps from shell.steps.ts.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { CONTENT_ISLAND, markDocument } from '../../support/shell';

function projectUrl(name: string): string {
  const url = php(
    '$e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${safe(name)}"])); print $e ? $e->toUrl()->toString() : "";`,
  );
  if (!url) {
    throw new Error(`No bb_project named "${name}" exists in the seeded world.`);
  }
  return url;
}

When('I click the project {string} in the listing', async ({ page }, name: string) => {
  const url = projectUrl(name);
  await page
    .locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`)
    .getByRole('link', { name, exact: true })
    .click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(url);
  await markDocument(page);
});

When('I visit the project {string}', async ({ page }, name: string) => {
  const url = projectUrl(name);
  const response = await page.goto(url);
  expect(response?.status() ?? 0, `The project "${name}" did not render`).toBeLessThan(400);
  await markDocument(page);
});

Then('the address is the detail of the project {string}', async ({ page }, name: string) => {
  expect(new URL(page.url()).pathname).toBe(projectUrl(name));
});

Then('the project Overview shows Activities, Properties and Epics', async ({ page }) => {
  const body = page.locator(CONTENT_ISLAND);
  await expect(body.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(body.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  await expect(body.getByRole('heading', { name: 'Epics', exact: true })).toBeVisible();
  await expect(body.getByRole('tab', { name: 'Epics' })).toHaveCount(0);
});

Then('the project Overview shows no count figures', async ({ page }) => {
  const main = page.locator('[data-canvas-region="main"]');
  const inspector = page.locator('[data-canvas-region="inspector"]');
  await expect(main.getByText('intake', { exact: true })).toHaveCount(0);
  await expect(main.getByText('in progress', { exact: true })).toHaveCount(0);
  await expect(inspector.getByText('intake', { exact: true })).toHaveCount(0);
  await expect(inspector.getByText('in progress', { exact: true })).toHaveCount(0);
});

Then('the inspector holds exactly one panel', async ({ page }) => {
  await expect(page.locator('[data-canvas-region="inspector"] > *')).toHaveCount(1);
});

Then('inspector panels fill the inspector column', async ({ page }) => {
  const measured = await page.evaluate(() => {
    const inspector = document.querySelector('[data-canvas-region="inspector"]');
    if (!(inspector instanceof HTMLElement)) {
      return { error: 'missing inspector' };
    }
    const column = inspector.getBoundingClientRect().width;
    const panels = Array.from(inspector.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (panels.length === 0) {
      return { error: 'no inspector panel' };
    }
    return {
      column,
      widths: panels.map((panel) => panel.getBoundingClientRect().width),
    };
  });
  expect(measured.error, JSON.stringify(measured)).toBeUndefined();
  expect(measured.widths?.length).toBeGreaterThan(0);
  for (const width of measured.widths ?? []) {
    expect(width).toBe(measured.column);
  }
});
