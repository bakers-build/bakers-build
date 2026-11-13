// Deployment presentation uses the existing disposable project world and cleanup.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { card } from '../board';
import { Drush, php } from '../drush';
import { safe } from '../listing';
import { requireWorld } from '../project-world';

Given('the world has an open deployment to {string} carrying {string}', async ({}, environment: string, titles: string) => {
  const world = requireWorld();
  const identifiers = titles.split(', ').map((title) => {
    const identifier = world.identifiers[title];
    if (!identifier) throw new Error(`No world ticket: ${title}`);
    return identifier;
  });
  const identifier = php([
    '$etm = \\Drupal::entityTypeManager(); $ts = $etm->getStorage("bb_ticket");',
    `$p = current($etm->getStorage("bb_project")->loadByProperties(["group_id" => ${world.ids.group}]));`,
    `$env = $etm->getStorage("bb_environment")->create(["name" => "${safe(environment)}", "project_id" => $p->id()]); $env->save();`,
    `$type = $etm->getStorage("bb_term")->create(["vid" => "type", "name" => "deployment", "workspace_id" => ${world.ids.workspace}]); $type->save();`,
    `$tickets = $ts->loadByProperties(["identifier" => ${JSON.stringify(identifiers)}]);`,
    '$d = $ts->create(["title" => "World release", "workflow" => "bb_work", "project_id" => $p->id(), "ticket_type" => $type->id(), "environments" => [$env->id()], "referenced_tickets" => array_keys($tickets)]); $d->save();',
    'print $d->getIdentifier();',
  ].join(' '));
  world.identifiers['World release'] = identifier;
  Drush.exec('search-api:index bb_tickets');
});

When('the world deployment is closed', async () => {
  const identifier = safe(requireWorld().identifiers['World release']);
  php(`$d = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")->loadByProperties(["identifier" => "${identifier}"])); $d->markClosed(\\Drupal::time()->getRequestTime()); $d->save();`);
  Drush.exec('search-api:index bb_tickets');
});

When('I open the world ticket {string}', async ({ page }, title: string) => {
  const world = requireWorld();
  const identifier = world.identifiers[title];
  if (!identifier) throw new Error(`No world ticket: ${title}`);
  const workspace = world.overview.split('/')[1];
  const response = await page.goto(`/${workspace}/ticket/${identifier.toLowerCase()}`);
  expect(response?.status()).toBe(200);
});

Then('the Overview deployment shows {string} and {string}', async ({ page }, environment: string, count: string) => {
  const section = page.getByRole('heading', { name: 'Deployments', exact: true }).locator('..').locator('..').locator('..');
  await expect(section.getByRole('link', { name: 'World release', exact: true })).toBeVisible();
  await expect(section.getByText(environment, { exact: true })).toBeVisible();
  await expect(section.getByRole('link', { name: count, exact: true })).toBeVisible();
  await expect(section.locator('time')).toHaveCount(1);
});

When('I follow the deployment ticket count {string}', async ({ page }, count: string) => {
  await page.getByRole('link', { name: count, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`deployment=${requireWorld().identifiers['World release']}`));
});

Then('the deployment ticket list shows only {string}', async ({ page }, titles: string) => {
  const rows = page.locator('[data-canvas-region="main"] [data-list-item]');
  await expect(rows).toHaveCount(titles.split(', ').length);
  for (const title of titles.split(', ')) await expect(rows.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Remove the Deployment filter', exact: true })).toBeVisible();
  await expect(page.locator('select[name="deployment"]')).toHaveCount(0);
});

Then(/^the board card "([^"]+)" (shows|does not show) the deployed badge "([^"]+)"$/, async ({ page }, title: string, shows: string, environment: string) => {
  const badge = card(page, title).locator(`[data-component-id="bb_theme:badge"][aria-label="Deployed to ${environment}"]`);
  await expect(badge).toHaveCount(shows === 'shows' ? 1 : 0);
  if (shows === 'shows') {
    await expect(badge).toHaveText(environment);
    await expect(badge.locator('a')).toHaveCount(0);
  }
});

Then(/^the ticket header (shows|does not show) the deployed badge "([^"]+)"$/, async ({ page }, shows: string, environment: string) => {
  const badge = page.locator(`[data-canvas-region="header"] [data-component-id="bb_theme:badge"][aria-label="Deployed to ${environment}"]`);
  await expect(badge).toHaveCount(shows === 'shows' ? 1 : 0);
  if (shows === 'shows') {
    await expect(badge).toHaveText(environment);
    await expect(badge.locator('a')).toHaveCount(0);
  }
});

When('I clear the deployment filter', async ({ page }) => {
  await page.getByRole('link', { name: 'Remove the Deployment filter', exact: true }).click();
});

Then('the deployment filter is cleared', async ({ page }) => {
  await expect.poll(() => new URL(page.url()).searchParams.has('deployment')).toBe(false);
  await expect(page.getByRole('link', { name: 'Remove the Deployment filter', exact: true })).toHaveCount(0);
  const rows = page.locator('[data-canvas-region="main"] [data-list-item]');
  await expect(rows).toHaveCount(3);
  await expect(rows.getByText('Other work', { exact: true })).toBeVisible();
});
