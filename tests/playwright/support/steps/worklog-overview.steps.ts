// Workspace My time steps on the time calendar. Consumer: features/worklog-overview.feature.
// Shared calendar vocabulary (strip, grid, filters) lives in time-calendar.steps.ts.
import { expect } from '@playwright/test';
import { Given, Then, When } from '../../bdd.fixtures';
import { php } from '../drush';
import { markDocument } from '../shell';

function projectId(name: string): string {
  const value = php(
    'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
      `->loadByProperties(["name" => "${name.replace(/["'\\$]/g, '')}"]))) ? $e->id() : "");`,
  );
  if (!value) {
    throw new Error(`No project named "${name}" exists.`);
  }
  return value;
}

/**
 * Pager rows for one overview week, created at runtime; Kernel owns the
 * same 26-row case.
 */
Given(
  'the account {string} has {int} one-minute entries dated {string} on project {string}',
  ({}, account: string, count: number, date: string, project: string) => {
    const name = account.replace(/["'\\$]/g, '');
    const projectName = project.replace(/["'\\$]/g, '');
    const day = date.replace(/[^0-9-]/g, '');
    const n = Math.floor(count);
    const created = php(
      `$user = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${name}"]));` +
        `$project = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${projectName}"]));` +
        `if (!$user || !$project) { print "missing"; }` +
        `else {` +
        `$storage = \\Drupal::entityTypeManager()->getStorage("bb_track_worklog");` +
        `$have = (int) $storage->getQuery()->accessCheck(FALSE)->condition("owner_user_id", $user->id())->condition("work_date", "${day}")->condition("description", "Overview pager minute", "STARTS_WITH")->count()->execute();` +
        `if ($have < ${n}) { for ($i = $have; $i < ${n}; $i++) { $storage->create(["owner_user_id" => $user->id(), "work_date" => "${day}", "timezone" => "Europe/Berlin", "duration_seconds" => 60, "description" => "Overview pager minute " . sprintf("%02d", $i), "derivation" => "manual", "state" => "recorded", "project_id" => $project->id()])->save(); } }` +
        `print "ok";` +
        `}`,
    );
    if (created !== 'ok') {
      throw new Error(`Could not seed pager rows for ${account} on ${project}.`);
    }
  },
);

Then('I see the My time action', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'My time', exact: true })).toBeVisible();
});

When('I open My time from My work', async ({ page }) => {
  await page.getByRole('link', { name: 'My time', exact: true }).click();
  await expect(page.getByText(/Week total|Total recorded time:/).first()).toBeVisible();
  await markDocument(page);
});

Then('I see the My time overview', async ({ page }) => {
  await expect(page.getByText(/Week total|Total recorded time:/).first()).toBeVisible();
  // The period controls form one toolbar above the rows; there is no rail.
  await expect(page.locator('[data-canvas-region="filters"]')).toHaveCount(0);
  const toolbar = page.getByRole('main').getByRole('search');
  await expect(toolbar).toBeVisible();
  const period = toolbar.getByRole('group', { name: 'Period', exact: true });
  await expect(period.getByRole('link', { name: 'Day', exact: true })).toBeVisible();
  await expect(period.getByRole('link', { name: 'Week', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('link', { name: 'Previous', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('link', { name: 'Next', exact: true })).toBeVisible();
});

Then('the My time heading describes recorded hours', async ({ page }) => {
  await expect(page.locator('[data-page-header] p')).toContainText(
    'Your recorded hours in the',
  );
});

Then('I see the invalid period message', async ({ page }) => {
  await expect(
    page.getByText(
      'Choose Day or Week, a calendar date, and filters offered on this page.',
    ),
  ).toBeVisible();
});

Then('the overview does not claim This week', async ({ page }) => {
  await expect(page.getByText('This week', { exact: true })).toHaveCount(0);
});

Then('the period chips have no remove control', async ({ page }) => {
  await expect(page.locator('[data-remove-facet]')).toHaveCount(0);
});

When('I choose overview mode {string}', async ({ page }, mode: string) => {
  await page.getByRole('group', { name: 'Period', exact: true }).getByRole('link', { name: mode, exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I set the overview date to {string}', async ({ page }, date: string) => {
  await page.locator('#edit-date').fill(date);
});


When('I apply the overview filters', async ({ page }) => {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I go to the previous overview period', async ({ page }) => {
  await page.getByRole('link', { name: 'Previous', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I go to the next overview period', async ({ page }) => {
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I go to today\'s overview period', async ({ page }) => {
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
});

Then('the address includes {string}', async ({ page }, fragment: string) => {
  expect(page.url()).toContain(fragment);
});

Then('the address does not include {string}', async ({ page }, fragment: string) => {
  expect(page.url()).not.toContain(fragment);
});

Then('the overview total is {string}', async ({ page }, total: string) => {
  await expect(page.getByRole('main')).toContainText(new RegExp(`(Total recorded time:|Week total)\\s*${total.replace(':', '\\:')}`));
});

Then('the overview shows {int} rows', async ({ page }, count: number) => {
  await expect(page.locator('[data-list-item]')).toHaveCount(count);
});

Then('the overview lists {string}', async ({ page }, description: string) => {
  await expect(page.locator('[data-list-item]').getByText(description, { exact: true })).toBeVisible();
});

Then('the overview does not list {string}', async ({ page }, description: string) => {
  await expect(page.locator('[data-list-item]').getByText(description, { exact: true })).toHaveCount(0);
});

Then('the overview is empty', async ({ page }) => {
  await expect(page.getByText('No time entries for this period.')).toBeVisible();
});

When('I open overview page 2', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Pagination' }).getByRole('link', { name: 'Page 2' }).click();
  await page.waitForLoadState('domcontentloaded');
});

When('I open the overview row described as {string}', async ({ page }, description: string) => {
  const row = page.locator('[data-list-item]').filter({ hasText: description });
  await row.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page.getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

When('I open the current time form with destination {string}', async ({ page }, destination: string) => {
  const url = new URL(page.url());
  url.searchParams.set('destination', destination);
  await page.goto(url.toString());
  await expect(page.getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

When(
  'I visit the overview {string} for project {string}',
  async ({ page }, path: string, project: string) => {
    const separator = path.includes('?') ? '&' : '?';
    await page.goto(`${path}${separator}project=${projectId(project)}`);
    await markDocument(page);
  },
);
