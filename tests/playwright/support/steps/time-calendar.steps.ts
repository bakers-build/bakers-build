// Time calendar steps: the personal, workspace, team and project views share
// one week strip, day list and week grid. Consumers: features/personal-time,
// team-time, project-time and worklog-overview.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Given, Then, When } from '@key-tec/playwright-core/bdd';
import { php } from '../drush';
import { facetRow, facetTrigger } from '../listing';
import { safe } from '../picker';
import { markDocument, PAGE_HEADER_ISLAND } from '../shell';

/** The id of a named entity, or a thrown error naming what is missing. */
function entityId(type: string, property: string, name: string): string {
  const id = php(
    `print (($e = current(\\Drupal::entityTypeManager()->getStorage("${type}")` +
      `->loadByProperties(["${property}" => "${safe(name)}"]))) ? $e->id() : "");`,
  );
  if (!id) {
    throw new Error(`No ${type} named "${name}" exists.`);
  }
  return id;
}

/** The workspace slug of a named team or project. */
function workspaceSlug(type: 'bb_team' | 'bb_project', name: string): string {
  const reach = type === 'bb_team' ? '$e->get("workspace_id")->entity' : '$e->get("group_id")->entity->get("workspace_id")->entity';
  const slug = php(
    `$e = current(\\Drupal::entityTypeManager()->getStorage("${type}")->loadByProperties(["name" => "${safe(name)}"]));` +
      `print $e ? ${reach}->getSlug() : "";`,
  );
  if (!slug) {
    throw new Error(`No ${type} named "${name}" exists.`);
  }
  return slug;
}

async function openCalendar(page: Page, path: string, query: string): Promise<void> {
  await page.goto(query ? `${path}?${query}` : path);
  await markDocument(page);
}

/** The week strip landmark. */
function strip(page: Page) {
  return page.getByRole('navigation', { name: /^Days of week / });
}

/** The day list of the calendar (not the strip, which is a list too). */
function dayList(page: Page) {
  return page.locator('[data-list-item]');
}

When(
  'I open the personal time view of {string} at {string}',
  async ({ page }, account: string, query: string) => {
    await openCalendar(page, `/user/${entityId('user', 'name', account)}/time`, query);
  },
);

When(
  'I open the team time view of {string} at {string}',
  async ({ page }, team: string, query: string) => {
    const path = `/${workspaceSlug('bb_team', team)}/team/${entityId('bb_team', 'name', team)}/time`;
    await openCalendar(page, path, query);
  },
);

When(
  'I open the project time view of {string} at {string}',
  async ({ page }, project: string, query: string) => {
    const path = `/${workspaceSlug('bb_project', project)}/project/${entityId('bb_project', 'name', project)}/time`;
    await openCalendar(page, path, query);
  },
);

When(
  'I open the team time view of {string} for the account {string} at {string}',
  async ({ page }, team: string, account: string, query: string) => {
    const path = `/${workspaceSlug('bb_team', team)}/team/${entityId('bb_team', 'name', team)}/time`;
    await openCalendar(page, path, `${query}&person=${entityId('user', 'name', account)}`);
  },
);

Then('the week strip shows {string} for {string}', async ({ page }, total: string, day: string) => {
  await expect(strip(page).getByRole('link', { name: `${day}, ${total}`, exact: true })).toBeVisible();
});

Then('the week total is {string}', async ({ page }, total: string) => {
  await expect(strip(page)).toContainText(new RegExp(`Week total\\s*${total.replace(':', '\\:')}`));
});

When('I open the day {string} in the week strip', async ({ page }, day: string) => {
  const date = day.split(' ').pop() ?? '';
  await strip(page).getByRole('link', { name: new RegExp(`^${day},`) }).click();
  await page.waitForURL((url) => url.searchParams.get('mode') === 'day' && url.searchParams.get('date') === date);
});

Then('the day lists {string}', async ({ page }, text: string) => {
  await expect(dayList(page).filter({ hasText: text }).first()).toBeVisible();
});

Then('the day does not list {string}', async ({ page }, text: string) => {
  await expect(dayList(page).filter({ hasText: text })).toHaveCount(0);
});

Then('the day row {string} has no Open link', async ({ page }, text: string) => {
  const row = dayList(page).filter({ hasText: text }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: 'Open', exact: true })).toHaveCount(0);
});

/** The grid cell of a row label under a column header such as "Tue 08". */
export async function gridCell(page: Page, row: string, column: string) {
  const table = page.getByRole('table');
  const headers = await table.getByRole('columnheader').allInnerTexts();
  const index = headers.findIndex((header) => header.trim() === column);
  expect(index, `No week grid column "${column}" in ${headers.join(', ')}`).toBeGreaterThan(-1);
  // The label is the row header, so the row is found by it and cells are
  // counted across header and data cells alike.
  const tableRow = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: row, exact: true }) }).first();
  return tableRow.locator('th, td').nth(index);
}

Then(
  'the week grid row {string} shows {string} on {string}',
  async ({ page }, row: string, value: string, column: string) => {
    const cell = await gridCell(page, row, column);
    // The employee's own week is editable: its cells are inputs, and a day
    // with several entries is a locked link that names the count.
    const input = cell.locator('input[type="text"]');
    if (await input.count()) {
      await expect(input).toHaveValue(value);
      return;
    }
    await expect(cell).toHaveText(new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( · \\d+ entries)?\\s*$`));
  },
);

Then('the week grid has no row {string}', async ({ page }, row: string) => {
  await expect(page.getByRole('table').getByRole('rowheader', { name: row, exact: true })).toHaveCount(0);
});

When('I open the week grid cell {string} on {string}', async ({ page }, row: string, column: string) => {
  const link = (await gridCell(page, row, column)).getByRole('link');
  const target = new URL((await link.getAttribute('href')) ?? '', page.url());
  await link.click();
  await page.waitForURL((url) => url.search === target.search);
});

/**
 * Picks a calendar filter value the way a keyboard user does: focus the row's
 * radio, press Space, then Apply with Enter, and wait for the address.
 */
When('I filter the time by {word} {string}', async ({ page }, field: string, value: string) => {
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  const row = await facetRow(page, label, value);
  const expected = await row.getAttribute('data-value');
  const input = row.locator('input');
  await input.focus();
  await page.keyboard.press(' ');
  await expect(input).toBeChecked();
  await page.getByRole('button', { name: 'Apply', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    ([key, wanted]) => new URLSearchParams(window.location.search).get(key) === wanted,
    [field, expected],
    { timeout: 20000 },
  );
  await markDocument(page);
});

Then('the time view offers no {word} filter', async ({ page }, field: string) => {
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  await expect(facetTrigger(page, label)).toHaveCount(0);
});

Then('the time scope reads {string}', async ({ page }, sentence: string) => {
  await expect(page.getByText(sentence, { exact: true }).first()).toBeVisible();
});

Then('the page offers the {string} tab', async ({ page }, tab: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).locator('[data-tabs]').getByRole('link', { name: tab, exact: true })).toBeVisible();
});

Then('the page does not offer the {string} tab', async ({ page }, tab: string) => {
  await expect(page.locator(PAGE_HEADER_ISLAND).locator('[data-tabs]').getByRole('link', { name: tab, exact: true })).toHaveCount(0);
});

When('I open the {string} tab', async ({ page }, tab: string) => {
  await page.locator(PAGE_HEADER_ISLAND).locator('[data-tabs]').getByRole('link', { name: tab, exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await markDocument(page);
});

When('I open the team {string}', async ({ page }, team: string) => {
  await openCalendar(page, `/${workspaceSlug('bb_team', team)}/team/${entityId('bb_team', 'name', team)}`, '');
});

When('I open the project {string}', async ({ page }, project: string) => {
  await openCalendar(page, `/${workspaceSlug('bb_project', project)}/project/${entityId('bb_project', 'name', project)}`, '');
});

Then('the account rail marks {string} as current', async ({ page }, item: string) => {
  await expect(page.getByRole('link', { name: item, exact: true }).first()).toHaveAttribute('aria-current', /page|true/);
});

When('I visit the delete form of the time entry described as {string}', async ({ page }, description: string) => {
  const uuid = php(
    '$e = current(\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")' +
      `->loadByProperties(["description" => "${safe(description)}"])); print $e ? $e->uuid() : "";`,
  );
  expect(uuid, `No time entry described as "${description}"`).not.toBe('');
  await page.goto(`/time/${uuid}/delete`);
});

/** The Record time trigger's plain page address (its href, not the dialog). */
function recordTimeHref(page: Page) {
  return page.getByRole('link', { name: 'Record time', exact: true }).first().getAttribute('href');
}

Then('Record time carries {string} as {string}', async ({ page }, key: string, value: string) => {
  const href = await recordTimeHref(page);
  expect(href).not.toBeNull();
  const url = new URL(href ?? '', page.url());
  const expected = key === 'project' && !/^\d+$/.test(value) ? entityId('bb_project', 'name', value) : value;
  expect(url.searchParams.get(key)).toBe(expected);
});

Then('Record time returns to this time view', async ({ page }) => {
  const href = await recordTimeHref(page);
  const url = new URL(href ?? '', page.url());
  const here = new URL(page.url());
  expect(url.searchParams.get('destination')).toBe(`${here.pathname}${here.search}`);
});

When('I follow Record time as a page', async ({ page }) => {
  const href = await recordTimeHref(page);
  await page.goto(new URL(href ?? '', page.url()).toString());
  await expect(page.getByLabel('Duration (hours:minutes)', { exact: true })).toBeVisible();
});

Given(
  'the account {string} has an entry described as {string} dated {string} on a project that was deleted',
  ({}, account: string, description: string, date: string) => {
    const result = php(
      `$user = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${safe(account)}"]));` +
        '$group = current(\\Drupal::entityTypeManager()->getStorage("bb_group")->loadByProperties(["name" => "Bread"]));' +
        'if (!$user || !$group) { print "missing"; } else {' +
        `$key = "DEL" . substr(md5("${safe(description)}"), 0, 5);` +
        // Project creation already seeds its own active Internal billing account.
        '$project = \\Drupal::entityTypeManager()->getStorage("bb_project")->create(["name" => "Deleted " . $key, "key" => strtoupper($key), "group_id" => $group->id(), "owner_user_id" => $user->id()]); $project->save();' +
        `\\Drupal::entityTypeManager()->getStorage("bb_track_worklog")->create(["owner_user_id" => $user->id(), "work_date" => "${date.replace(/[^0-9-]/g, '')}", "timezone" => "Europe/Berlin", "duration_seconds" => 900, "description" => "${safe(description)}", "derivation" => "manual", "state" => "recorded", "project_id" => $project->id()])->save();` +
        '$project->delete(); print "ok"; }',
    );
    if (result !== 'ok') {
      throw new Error(`Could not seed a deleted-project entry for ${account}: ${result}`);
    }
  },
);

Then('I do not see the text {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toHaveCount(0);
});
