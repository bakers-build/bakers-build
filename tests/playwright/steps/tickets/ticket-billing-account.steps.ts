// The ticket inspector's Billing row: fixture accounts and tickets, the row's
// value and Source, the picker / no-JS choice and the link route's status.
// The fresh project and the sign-in steps come from billing-accounts.steps.ts,
// listing.steps.ts and accounts.steps.ts.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { expect, type Locator, type Page } from '@playwright/test';
import { php, phpUnderLock } from '../../support/drush';
import { safe } from '../../support/listing';
import { markDocument } from '../../support/shell';

const linkStatus = new WeakMap<object, { status: number; location: string }>();

/**
 * Ids this scenario created, by title / name. Titles repeat across runs and
 * across the JS and no-JS projects, so a lookup by title alone is ambiguous.
 */
const created = new WeakMap<object, Record<string, string>>();

function remember(page: Page, key: string, id: string): void {
  created.set(page, { ...(created.get(page) ?? {}), [key]: id });
}

function recalled(page: Page, key: string): string {
  const id = created.get(page)?.[key];
  if (!id) {
    throw new Error(`This scenario created no "${key}".`);
  }
  return id;
}

/** Prints `$p`, the project named so, into a PHP snippet. */
function projectNamed(name: string): string {
  return `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${safe(name)}"]));`;
}

/** A ticket this scenario created: id, canonical path and identifier. */
function ticketTitled(page: Page, title: string): { id: string; path: string; identifier: string } {
  const id = recalled(page, `ticket:${title}`);
  const [path, identifier] = php(
    `$t = \\Drupal::entityTypeManager()->getStorage("bb_ticket")->load(${id});` +
      'print $t->toUrl()->toString() . "|" . $t->getIdentifier();',
  ).split('|');
  return { id, path, identifier };
}

function billingRows(page: Page): Locator {
  return page.locator('[data-list-item]').filter({ hasText: /^\s*(Billing|Source)\b/ });
}

Given('the project {string} has the billing account {string}', async ({ page }, project: string, name: string) => {
  const id = await phpUnderLock(
    [
      projectNamed(project),
      '$s = \\Drupal::entityTypeManager()->getStorage("bb_track_account");',
      `$a = $s->create(["name" => "${safe(name)}", "external_id" => "HARV-${safe(name)}", "project_id" => $p->id()]);`,
      '$a->save(); print $a->id();',
    ].join(' '),
  );
  expect(id).toMatch(/^\d+$/);
  remember(page, `account:${name}`, id);
});

Given(
  'the project {string} has the epic {string} with the child {string}',
  async ({ page }, project: string, epic: string, child: string) => {
    const ids = php(
      [
        projectNamed(project),
        '$s = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
        `$e = $s->create(["title" => "${safe(epic)}", "project_id" => $p->id(), "workflow" => "bb_feature"]); $e->save();`,
        `$c = $s->create(["title" => "${safe(child)}", "project_id" => $p->id(), "parent_id" => $e->id(), "workflow" => "bb_feature"]); $c->save();`,
        'print $e->id() . "," . $c->id();',
      ].join(' '),
    );
    expect(ids).toMatch(/^\d+,\d+$/);
    const [epicId, childId] = ids.split(',');
    remember(page, `ticket:${epic}`, epicId);
    remember(page, `ticket:${child}`, childId);
  },
);

Given(
  'the ticket titled {string} is linked to the billing account {string}',
  async ({ page }, title: string, name: string) => {
    const ticket = ticketTitled(page, title);
    const linked = await phpUnderLock(
      [
        '$s = \\Drupal::entityTypeManager()->getStorage("bb_track_account");',
        `$a = $s->load(${recalled(page, `account:${name}`)});`,
        `$a->get("tickets")->appendItem(${ticket.id}); $a->save(); print $a->id();`,
      ].join(' '),
    );
    expect(linked).toMatch(/^\d+$/);
  },
);

When('I open the ticket titled {string}', async ({ page }, title: string) => {
  await page.goto(ticketTitled(page, title).path);
  await markDocument(page);
});

Then('the ticket billing reads {string} from {string}', async ({ page }, account: string, source: string) => {
  await expect(billingRows(page).first()).toContainText(account);
  await expect(billingRows(page).nth(1)).toContainText(source);
});

Then(
  'the ticket billing reads {string} from the ticket titled {string}',
  async ({ page }, account: string, title: string) => {
    await expect(billingRows(page).first()).toContainText(account);
    await expect(billingRows(page).nth(1)).toContainText(`from ${ticketTitled(page, title).identifier}`);
  },
);

Then('the ticket billing offers no picker', async ({ page }) => {
  await expect(billingRows(page).first().locator('[data-option-picker]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save billing account', exact: true })).toHaveCount(0);
});

When('I link the ticket to the billing account {string}', async ({ page }, name: string) => {
  const row = billingRows(page).first();
  await row.locator('[data-option-picker-trigger]').click();
  // An option's accessible name carries its external ID as a description.
  await expect(row.getByRole('option').filter({ hasText: name }).first()).toContainText(`HARV-${name}`);
  await row.getByRole('option').filter({ hasText: name }).first().click();
  await page.getByRole('button', { name: 'Save billing account', exact: true }).click();
  await expect(page.getByText('Billing account linked to this ticket.')).toBeVisible();
  await markDocument(page);
});

When('I let the ticket inherit its billing account', async ({ page }) => {
  const row = billingRows(page).first();
  await row.locator('[data-option-picker-trigger]').click();
  await row.getByRole('option').filter({ hasText: 'Inherit' }).first().click();
  await page.getByRole('button', { name: 'Save billing account', exact: true }).click();
  await expect(page.getByText('This ticket inherits its billing account again.')).toBeVisible();
  await markDocument(page);
});

When('I choose the billing account {string} without JavaScript', async ({ page }, name: string) => {
  await page.getByRole('combobox', { name: 'Billing account', exact: true }).selectOption({ label: name });
  await page.getByRole('button', { name: 'Save billing account', exact: true }).click();
  await markDocument(page);
});

When('I open Record time for the ticket titled {string}', async ({ page }, title: string) => {
  const ticket = ticketTitled(page, title);
  const project = php(
    `print \\Drupal::entityTypeManager()->getStorage("bb_ticket")->load(${ticket.id})->get("project_id")->target_id;`,
  );
  await page.goto(`/time/add?project=${project}&ticket=${ticket.id}`);
  await markDocument(page);
});

Then('Record time preselects the billing account {string}', async ({ page }, name: string) => {
  await expect(page.locator('[data-option-picker-label="Billing account"]').first()).toContainText(name);
});

Then('the billing account {string} is active and links no ticket', async ({ page }, name: string) => {
  const state = php(
    `$a = \\Drupal::entityTypeManager()->getStorage("bb_track_account")->load(${recalled(page, `account:${name}`)});` +
      'print $a ? (int) $a->get("active")->value . ":" . count($a->get("tickets")) : "";',
  );
  expect(state).toBe('1:0');
});

When('I request the billing link route of the ticket titled {string}', async ({ page }, title: string) => {
  const response = await page.request.get(`${ticketTitled(page, title).path}/billing-account`, { maxRedirects: 0 });
  linkStatus.set(page, { status: response.status(), location: response.headers().location ?? '' });
});

Then('the billing link route answers {int}', async ({ page }, status: number) => {
  expect(linkStatus.get(page)?.status).toBe(status);
});

Then('the billing link route redirects to sign-in', async ({ page }) => {
  const answer = linkStatus.get(page);
  expect(answer?.status).toBe(302);
  expect(answer?.location).toContain('/user/login');
});
