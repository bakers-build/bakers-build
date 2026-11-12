// Project Overview: the canonical `full` view mode (metrics, Needs attention,
// Epics and Activities; About and Properties in the inspector).
// `I visit the {string} listing` comes from projects-list.steps.ts;
// tab/heading/document/rail steps from shell.steps.ts and
// steps/shell/sidebar-collapse.steps.ts; the disposable project
// world from support/steps/project-health-world.steps.ts.
import { When, Then } from '../../bdd.fixtures';
import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
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

/** The Needs attention section: the zone its heading belongs to. */
function attention(page: Page) {
  return page
    .getByRole('heading', { name: 'Needs attention', exact: true })
    .locator('xpath=ancestor::*[@data-component-id="bb_theme:zone"][1]');
}

// A metric tile is a group named by its value and label, "3 Unhealthy".
Then('the Overview metrics read {string}', async ({ page }, metrics: string) => {
  for (const metric of metrics.split(', ')) {
    const [, label, value] = metric.match(/^(.+) (\d+)$/) ?? [];
    await expect(page.getByRole('group', { name: `${value} ${label}`, exact: true })).toBeVisible({ timeout: 10000 });
  }
});

When('I click the Overview metric {string}', async ({ page }, label: string) => {
  await page.getByRole('link', { name: new RegExp(`^\\d+ ${label}$`) }).click();
});

Then('Needs attention lists:', async ({ page }, table: DataTable) => {
  const rows = attention(page).locator('li[data-list-item]');
  const expected = table.hashes();
  await expect(rows).toHaveCount(expected.length, { timeout: 10000 });
  for (const [index, { ticket, reason }] of expected.entries()) {
    await expect(rows.nth(index).getByText(ticket, { exact: true })).toBeVisible();
    await expect(rows.nth(index).getByText(reason, { exact: true })).toBeVisible();
  }
});

Then('Needs attention does not list {string}', async ({ page }, ticket: string) => {
  await expect(attention(page).locator('li[data-list-item]').first()).toBeVisible({ timeout: 10000 });
  await expect(attention(page).getByText(ticket, { exact: true })).toHaveCount(0);
});

Then('Needs attention reads {string}', async ({ page }, text: string) => {
  await expect(attention(page).getByText(text, { exact: true })).toBeVisible({ timeout: 10000 });
});

Then('the Overview shows only the empty state {string}', async ({ page }, title: string) => {
  const main = page.locator('[data-canvas-region="main"]');
  await expect(main.getByText(title, { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(main.getByRole('group', { name: /\d+ Unhealthy$/ })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Needs attention', exact: true })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Epics', exact: true })).toHaveCount(0);
});

Then(/^the Properties card (offers|does not offer) Edit$/, async ({ page }, offers: string) => {
  const inspector = page.locator('[data-canvas-region="inspector"]');
  await expect(inspector.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(inspector.getByRole('link', { name: 'Edit', exact: true })).toHaveCount({ offers: 1, 'does not offer': 0 }[offers]);
});

// Each answer and whether its page names the project.
let refused: { url: string; status: number; named: boolean }[] = [];

When('I request the Overview and the Board of the project {string}', async ({ page }, name: string) => {
  const url = projectUrl(name);
  refused = [];
  for (const target of [url, `${url}/board`]) {
    const response = await page.goto(target);
    refused.push({ url: target, status: response?.status() ?? 0, named: (await page.content()).includes(name) });
  }
});

Then('both answer {int} without project data', async ({}, status: number) => {
  expect(refused).toHaveLength(2);
  for (const { url, status: actual, named } of refused) {
    expect(actual, url).toBe(status);
    expect(named, url).toBe(false);
  }
});
