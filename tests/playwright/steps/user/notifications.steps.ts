// Notification settings in the user area, and the activity mails they select.
// Consumers: features/user/notification-settings.feature, features/user/activity-mails.feature.
import { Given, When, Then } from '../../bdd.fixtures';
import { createBdd } from 'playwright-bdd';
import { expect, type Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { RAIL_ISLAND, uidOf } from '../../support/shell';
import { createDisposableTicket, deleteDisposableTicket, lastLine, subject } from '../../support/disposable-ticket';
import { bodyOf, clearMailboxFor, messagesFor } from '../../support/login-flow';

const { Before, After } = createBdd(test);

// A mail scenario makes several drush calls (about 4 s each through the ddev fallback), a mail-based
// login and a few page loads: with parallel workers that does not fit the 60 s default.
Before({ tags: '@feature:activity-mails' }, async ({ $testInfo }) => {
  $testInfo.setTimeout(120_000);
});

const SETTINGS_FORM = 'form#bb-notification-setting-form';
const rail = (page: Page) => page.locator(RAIL_ISLAND);
const group = (page: Page, name: string) => page.locator(SETTINGS_FORM).getByRole('group', { name });

/** Accounts whose settings a scenario changed, reset after it. */
const touched = new WeakMap<Page, string[]>();

/** Puts an account's row back to the shipped state: nothing ticked. */
export function resetNotificationSettings(account: string): void {
  php(
    '$etm = \\Drupal::entityTypeManager();' +
      ` $u = current($etm->getStorage("user")->loadByProperties(["name" => "${safe(account)}"]));` +
      ' if ($u) { foreach ($etm->getStorage("bb_notification_setting")->loadByProperties(["user_id" => $u->id()]) as $r) {' +
      ' $r->set("messages", [])->save(); } }' +
      ' print "ok";',
  );
}

/** Remembers an account for the After hook and resets it now. */
export function touch(page: Page, account: string): void {
  resetNotificationSettings(account);
  touched.set(page, [...(touched.get(page) ?? []), account]);
}

After({ tags: '@feature:notification-settings' }, async ({ page }) => {
  for (const account of touched.get(page) ?? []) {
    resetNotificationSettings(account);
  }
  touched.delete(page);
});

Given('the notification settings of {string} are untouched', async ({ page }, account: string) => {
  touch(page, account);
});

When('I open the notification settings of {string}', async ({ page }, account: string) => {
  await page.goto(`/user/${uidOf(account)}/notifications`);
});

When('I follow {string} in the user-area rail', async ({ page }, label: string) => {
  await rail(page).getByRole('link', { name: label, exact: true }).click();
  await page.waitForLoadState();
});

Then('the user-area rail lists {string} directly after {string}', async ({ page }, entry: string, before: string) => {
  const titles = (await rail(page).getByRole('navigation').getByRole('link').allInnerTexts()).map((title) => title.trim());
  expect(titles, `rail entries: ${titles.join(', ')}`).toContain(entry);
  expect(titles.indexOf(entry)).toBe(titles.indexOf(before) + 1);
});

Then('the user-area rail marks {string} as the current entry', async ({ page }, entry: string) => {
  await expect(rail(page).getByRole('link', { name: entry, exact: true })).toHaveAttribute('aria-current', 'page');
});

Then('the notification settings form is inside the app shell', async ({ page }) => {
  await expect(page.locator(SETTINGS_FORM)).toBeVisible();
  await expect(rail(page).getByRole('link', { name: 'Account', exact: true })).toBeVisible();
});

When('I tick {string} under {string}', async ({ page }, option: string, groupName: string) => {
  await group(page, groupName).getByRole('checkbox', { name: option, exact: true }).check();
});

When('I save the notification settings', async ({ page }) => {
  await page.locator(SETTINGS_FORM).getByRole('button', { name: 'Save notification settings', exact: true }).click();
  await page.waitForLoadState();
});

Then('the notification settings confirm the save', async ({ page }) => {
  await expect(page.getByText('Notification settings saved.', { exact: true })).toBeVisible();
});

Then('{string} is ticked under {string}', async ({ page }, option: string, groupName: string) => {
  await expect(group(page, groupName).getByRole('checkbox', { name: option, exact: true })).toBeChecked();
});

Then('{string} is not ticked under {string}', async ({ page }, option: string, groupName: string) => {
  await expect(group(page, groupName).getByRole('checkbox', { name: option, exact: true })).not.toBeChecked();
});

Then('the notification settings offer {string}', async ({ page }, groupName: string) => {
  await expect(group(page, groupName)).toBeVisible();
});

Then('the notification settings do not offer {string}', async ({ page }, groupName: string) => {
  await expect(page.locator(SETTINGS_FORM)).toBeVisible();
  await expect(group(page, groupName)).toHaveCount(0);
});

const activityMail = new WeakMap<Page, string>();
/** The recipient's address, read once while the ticket is set up: every drush call is seconds. */
const recipientAddress = new WeakMap<Page, string>();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

After({ tags: '@feature:activity-mails' }, async ({ page }) => {
  for (const account of touched.get(page) ?? []) {
    resetNotificationSettings(account);
  }
  touched.delete(page);
  activityMail.delete(page);
  recipientAddress.delete(page);
  deleteDisposableTicket(page);
});

/**
 * Creates the disposable ticket owned by an account and reads the account's address in the same
 * drush call; the mailbox is emptied before the scenario acts.
 */
async function ticketOwnedBy(page: Page, baseURL: string, state: string, account: string) {
  const ticket = createDisposableTicket(page, 'bb_work', state, 'none');
  const uid = uidOf(account);
  const address = lastLine(
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket.ticket}");` +
      ` $t->set("owner_user_id", ${uid})->save();` +
      ` print \\Drupal\\user\\Entity\\User::load(${uid})->getEmail();`,
  );
  recipientAddress.set(page, address);
  await clearMailboxFor(page, baseURL, address);
}

Given(
  'a disposable ticket in state {string} is owned by {string}',
  async ({ page, baseURL }, state: string, account: string) => {
    await ticketOwnedBy(page, baseURL!, state, account);
  },
);

When('{string} is made the assignee of the disposable ticket', async ({ page }, account: string) => {
  lastLine(
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${subject(page).ticket}");` +
      ` $t->set("assignee_user_id", ${uidOf(account)})->save(); print "ok";`,
  );
});

When('{string} is added as a reviewer of the disposable ticket', async ({ page }, account: string) => {
  lastLine(
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${subject(page).ticket}");` +
      ` $t->set("reviewers", [${uidOf(account)}])->save(); print "ok";`,
  );
});

Then(
  '{string} receives exactly one activity mail for the disposable ticket',
  async ({ page, baseURL }, account: string) => {
    const { identifier } = subject(page);
    const address = recipientAddress.get(page)!;
    const mails = async () => (await messagesFor(page, baseURL!, address))
      .filter((message) => String(message.Subject ?? '').includes(`[${identifier}]`));
    // Sent in the request that saved the change; Mailpit may index it a moment later.
    await expect.poll(async () => (await mails()).length).toBe(1);
    activityMail.set(page, String((await mails())[0].ID));
  },
);

Then(
  'that mail says {string} and links to the disposable ticket',
  async ({ page, baseURL }, sentence: string) => {
    const { url } = subject(page);
    const text = await bodyOf(page, baseURL!, activityMail.get(page)!);
    expect(text).toContain(sentence);
    expect(text).toMatch(new RegExp(`https?://\\S+${escapeRegExp(url)}`));
  },
);
