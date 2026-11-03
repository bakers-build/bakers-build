// BB-529 — the user area is split into `/user/{user}` (view, no tab row)
// and `/user/{user}/edit` (the settings form). No island governs either
// route — both are an ordinary entity view and an ordinary entity form — so
// most assertions here are about form state, markup and route identity, not
// about a client-side swap. `markDocument`/`documentWasKept` are not needed
// for that reason; what IS reused is `I am logged in as the account` from
// `support/steps/accounts.steps.ts`. The `php`/`safe` helpers are local: a
// snippet-runner has no state to share across files.
import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { CONTENT_ISLAND, PAGE_HEADER_ISLAND, RAIL_ISLAND } from '../../support/shell';

function php(snippet: string): string {
  if (snippet.includes("'")) {
    throw new Error('A drush ev snippet must contain no single quote.');
  }
  return Drush.exec(`ev '${snippet}'`).trim();
}

function safe(value: string): string {
  if (value.includes('"') || value.includes('\\')) {
    throw new Error('Fixture value must contain no quote or backslash.');
  }
  return value;
}

/**
 * The uid behind a fixture account name, resolved once per step.
 */
function uidOf(name: string): string {
  const uid = php(
    'print (($u = current(\\Drupal::entityTypeManager()->getStorage("user")' +
      `->loadByProperties(["name" => "${safe(name)}"]))) ? $u->id() : "");`,
  );
  if (!uid) {
    throw new Error(`No account named "${name}" exists.`);
  }
  return uid;
}

const TOKEN_VALUE = 'bb-507-fixture-token-do-not-render';

Given('the account {string} is linked to an oauth provider', async ({}, name: string) => {
  const uid = uidOf(name);
  php(
    `$u = ${uid}; $existing = \\Drupal::entityTypeManager()->getStorage("social_auth")` +
      `->loadByProperties(["user_id" => $u]); foreach ($existing as $e) { $e->delete(); } ` +
      '\\Drupal\\social_auth\\Entity\\SocialAuth::create([' +
      `"user_id" => $u, "plugin_id" => "social_auth_google", "provider_user_id" => "g-507", ` +
      `"token" => "${TOKEN_VALUE}", "additional_data" => []])->save();`,
  );
});

Given('the account {string} is not linked to an oauth provider', async ({}, name: string) => {
  const uid = uidOf(name);
  php(
    `$u = ${uid}; foreach (\\Drupal::entityTypeManager()->getStorage("social_auth")` +
      '->loadByProperties(["user_id" => $u]) as $e) { $e->delete(); }',
  );
});

Given('the account {string} has no context answers', async ({}, name: string) => {
  const uid = uidOf(name);
  php(
    `$u = \\Drupal\\user\\Entity\\User::load(${uid}); ` +
      '$u->set("field_bb_background", NULL); $u->save();',
  );
});

When('I visit my user area', async ({ page }) => {
  const uid = uidOf('north-lead');
  await page.goto(`/user/${uid}`);
});

When('I visit my profile settings', async ({ page }) => {
  const uid = uidOf('north-lead');
  await page.goto(`/user/${uid}/edit`);
});

When('I visit the user area of {string}', async ({ page }, name: string) => {
  await page.goto(`/user/${uidOf(name)}`);
});

When('I visit the profile settings of {string}', async ({ page }, name: string) => {
  await page.goto(`/user/${uidOf(name)}/edit`);
});

Given(
  'the account {string} has full name {string} and developer title {string}',
  async ({}, name: string, fullName: string, title: string) => {
    php(
      `$u = \\Drupal\\user\\Entity\\User::load(${uidOf(name)}); ` +
        `$u->set("field_full_name", "${safe(fullName)}"); $u->set("field_developer_title", "${safe(title)}"); $u->save();`,
    );
  },
);

Given('the account {string} has no full name and no developer title', async ({}, name: string) => {
  php(
    `$u = \\Drupal\\user\\Entity\\User::load(${uidOf(name)}); ` +
      '$u->set("field_full_name", NULL); $u->set("field_developer_title", NULL); $u->save();',
  );
});

When('I click {string} in the page header', async ({ page }, label: string) => {
  const current = page.url();
  await page.locator(PAGE_HEADER_ISLAND).getByRole('link', { name: label, exact: true }).click();
  await page.waitForURL((url) => url.toString() !== current);
});

Then('I am on the edit route of {string}', async ({ page }, name: string) => {
  await expect(page).toHaveURL(new RegExp(`/user/${uidOf(name)}/edit$`));
});

Then('I am on the canonical route of {string}', async ({ page }, name: string) => {
  await expect(page).toHaveURL(new RegExp(`/user/${uidOf(name)}$`));
});

Then('the profile form is inside the app shell', async ({ page }) => {
  await expect(page.locator(RAIL_ISLAND)).toBeVisible();
  await expect(page.locator(PAGE_HEADER_ISLAND)).toBeVisible();
  await expect(page.locator(`${CONTENT_ISLAND} form.user-form`)).toHaveCount(1);
  await expect(page.locator('form.user-form')).toHaveCount(1);
});

Then(
  'the user overview shows the name {string} and the developer title {string}',
  async ({ page }, displayName: string, title: string) => {
    const body = page.locator(CONTENT_ISLAND);
    await expect(page.locator(RAIL_ISLAND)).toBeVisible();
    await expect(body.locator('[data-person-mark]')).toHaveCount(1);
    await expect(body.locator('[data-person-mark]')).toBeVisible();
    await expect(body).toContainText(displayName);
    await expect(body).toContainText(title);
  },
);

Then('the user overview shows the name {string} and no developer title', async ({ page }, displayName: string) => {
  const body = page.locator(CONTENT_ISLAND);
  await expect(body.locator('[data-person-mark]')).toHaveCount(1);
  await expect(body).toContainText(displayName);
  await expect(body).not.toContainText('Position');
});

Then('the user overview does not disclose the mail of {string}', async ({ page }, name: string) => {
  const mail = php(`print \\Drupal\\user\\Entity\\User::load(${uidOf(name)})->getEmail();`);
  await expect(page.locator(CONTENT_ISLAND)).not.toContainText(mail);
});

Then('the view and edit routes of {string} are denied to me', async ({ page }, name: string) => {
  const uid = uidOf(name);
  for (const path of [`/user/${uid}`, `/user/${uid}/edit`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
  }
});

When(
  'I fill in the profile with full name {string} and developer title {string}',
  async ({ page }, fullName: string, title: string) => {
    await page.locator('[name="field_full_name[0][value]"]').fill(fullName);
    await page.locator('[name="field_developer_title[0][value]"]').fill(title);
  },
);

When('I save the profile form', async ({ page }) => {
  const navigation = page.waitForNavigation({ waitUntil: 'load' });
  await page.getByRole('button', { name: 'Save' }).click();
  await navigation;
});

Then('the page is styled by the theme', async ({ page }) => {
  // None of htmx's transport keys may survive into the landing page's URL.
  await expect(page).not.toHaveURL(/ajax_page_state|_wrapper_format|_triggering_element_/);
  // Unstyled, the page falls back to the browser's default serif font.
  await expect(page.locator('link[rel="stylesheet"]').first()).toBeAttached();
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).fontFamily)).not.toMatch(/^"?Times/);
});

Then('the full name field holds {string}', async ({ page }, value: string) => {
  await expect(page.locator('[name="field_full_name[0][value]"]')).toHaveValue(value);
});

Then('the developer title field holds {string}', async ({ page }, value: string) => {
  await expect(page.locator('[name="field_developer_title[0][value]"]')).toHaveValue(value);
});

Then('the mail field is disabled', async ({ page }) => {
  await expect(page.locator('[name="mail"]')).toBeDisabled();
});

Then('the mail field is not disabled', async ({ page }) => {
  await expect(page.locator('[name="mail"]')).toBeEnabled();
});

Then("the mail field's description names the provider", async ({ page }) => {
  await expect(page.locator('#edit-mail--description')).toContainText(/google/i);
});

Then('the page has no profile form', async ({ page }) => {
  await expect(page.locator('form.user-form')).toHaveCount(0);
});

Then('the page has no password field', async ({ page }) => {
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

const AI_USE_NOTICE = 'bakers.build passes these details as context to the AI assistants it uses';

Then('the profile form has no retired account fields', async ({ page }) => {
  await expect(page.locator('form.user-form')).toBeVisible();
  await expect(
    page.locator('[name^="bb_platform_usernames"], [name^="field_bb_activity"], [name^="field_bb_depth"]'),
  ).toHaveCount(0);
  await expect(page.getByText('Social Authentications', { exact: true })).toHaveCount(0);
});

Then('the AI-use notice is shown before the context questions', async ({ page }) => {
  const notice = page.getByText(AI_USE_NOTICE);
  const firstQuestion = page.getByLabel('What should bakers.build know about your background?', { exact: true });
  await expect(notice).toBeVisible();
  await expect(firstQuestion).toBeVisible();
  const precedes = await notice.evaluate(
    (node, question) => Boolean(node.compareDocumentPosition(question as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await firstQuestion.elementHandle(),
  );
  expect(precedes, 'the AI-use notice does not come before the first context question').toBe(true);
});

// Writes the Background account's own context field. No other feature
// reads them, and every run writes the same fixed values.
When('I answer the context questions with:', async ({ page }, table: DataTable) => {
  for (const [question, answer] of table.raw()) {
    await page.getByLabel(question, { exact: true }).fill(answer);
  }
});

Then('the context questions hold:', async ({ page }, table: DataTable) => {
  for (const [question, answer] of table.raw()) {
    await expect(page.getByLabel(question, { exact: true })).toHaveValue(answer);
  }
});
