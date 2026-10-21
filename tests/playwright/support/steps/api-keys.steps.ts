// Self-service API keys: creation/reveal, list, revoke, OAuth
// identity, and owner-only access control. Consumers: features/user/api-keys.
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php } from '../drush';
import { uidOf } from '../shell';

const { Given, When, Then, After } = createBdd(test);

interface IssuedKey {
  clientId: string;
  secret: string;
}

/**
 * Reads the command text out of a `setup_command` copy item, located by its
 * Copy control's accessible label (Client ID and Secret are no longer plain
 * readonly fields, see ApiKeyCreateForm::buildResult()).
 */
async function commandText(scope: Page | ReturnType<Page['locator']>, label: string): Promise<string> {
  return scope
    .locator(`xpath=.//div[@x-data][.//button[@aria-label="${label}"]]//code`)
    .innerText();
}

let issuedKey: IssuedKey | undefined;
let accessToken: string | undefined;
const createdClientIds: string[] = [];

After(() => {
  // Each scenario mints at least one real consumer; delete them all so a
  // `.first()` locator in a later run can never land on a leftover key.
  while (createdClientIds.length > 0) {
    const clientId = createdClientIds.pop();
    php(
      `($c = current(\\Drupal::entityTypeManager()->getStorage("consumer")` +
        `->loadByProperties(["client_id" => "${clientId}"]))) && $c->delete();`,
    );
  }
  issuedKey = undefined;
  accessToken = undefined;
});

function ownerUid(): string {
  return uidOf('cwiedemann');
}

When('I visit my API keys page', async ({ page }) => {
  await page.goto(`/user/${ownerUid()}/api-keys`);
});

/**
 * Opens the create dialog from the page-header plus and submits it.
 */
async function createThroughDialog(page: Page, label: string, days: number): Promise<IssuedKey> {
  await page.goto(`/user/${ownerUid()}/api-keys`);
  await page.getByRole('link', { name: 'Create API key' }).first().click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Name').fill(label);
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + days);
  await dialog.getByLabel('Expires').fill(expires.toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Create API key' }).click();
  // The one-time result replaces the form inside the same dialog.
  const result = page.locator('dialog[open]');
  await expect(result.getByRole('button', { name: 'Copy the secret' })).toBeVisible();
  const clientId = await commandText(result, 'Copy the client ID');
  createdClientIds.push(clientId);
  return {
    clientId,
    secret: await commandText(result, 'Copy the secret'),
  };
}

When(
  'I create an API key named {string} expiring in {int} days',
  async ({ page }, label: string, days: number) => {
    issuedKey = await createThroughDialog(page, label, days);
  },
);

Then("the created API key's client ID and secret are shown", async ({ page }) => {
  expect(issuedKey!.clientId).toMatch(/^bakers-key-/);
  expect(issuedKey!.secret.length).toBeGreaterThan(20);
  // JS: the result replaces the form inside the dialog. No-JS: the create
  // form is a full page, there is no <dialog>, so scope to the page body.
  const dialog = page.locator('dialog[open]');
  const scope = (await dialog.count()) > 0 ? dialog : page.locator('body');
  await expect(scope).toContainText('shown once');
});

When('I close the API key dialog', async ({ page }) => {
  // Done carries `data-dialog-reload`: the hull closes in place and the list
  // screen underneath reloads, so the new key is shown without its secret.
  await page.locator('dialog[open]').getByRole('link', { name: 'Done' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

Then(
  'the API key {string} is listed as active without its secret',
  async ({ page }, label: string) => {
    // The client ID is unique; labels repeat across parallel scenarios.
    const row = page.locator('li', { hasText: issuedKey!.clientId });
    await expect(row).toContainText(label);
    await expect(row).toContainText('Active');
    await expect(page.locator('body')).not.toContainText(issuedKey!.secret);
  },
);

Given(
  'I have created my own API key named {string} through the user area',
  async ({ page }, label: string) => {
    issuedKey = await createThroughDialog(page, label, 30);
  },
);

When("that key's credentials are exchanged for an access token", async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/oauth/token`, {
    form: {
      grant_type: 'client_credentials',
      client_id: issuedKey!.clientId,
      client_secret: issuedKey!.secret,
    },
  });
  accessToken = response.ok() ? (await response.json()).access_token : undefined;
});

Then('the token exchange succeeds', () => {
  expect(accessToken).toBeDefined();
});

function ownWorkspaceUuid(): string {
  return php(
    'print (($w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")' +
      '->loadByProperties(["slug" => "bakers"]))) ? $w->uuid() : "");',
  );
}

function otherWorkspaceUuid(): string {
  // `cwiedemann` is explicitly not a member of this workspace (the
  // wrong-workspace fixture, `bb_workspace/dbc60000-…-000000000002`).
  return 'dbc60000-0000-4000-8000-000000000002';
}

Then(
  "a request bearing that token can read {string}'s own workspace",
  async ({ request, baseURL }, _owner: string) => {
    const response = await request.get(
      `${baseURL}/jsonapi/bb_workspace/bb_workspace/${ownWorkspaceUuid()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(response.status()).toBe(200);
  },
);

Then(
  'a request bearing that token is denied write access to a workspace {string} is not a member of',
  async ({ request, baseURL }, _owner: string) => {
    // Tenancy fence only: this is refused with or without the owner-identity
    // conversion. Exact owner permissions are proven by
    // ApiKeyOAuthTest::testRealManagedTokenCarriesExactlyOwnerPermissions.
    const uuid = otherWorkspaceUuid();
    const response = await request.patch(`${baseURL}/jsonapi/bb_workspace/bb_workspace/${uuid}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      data: {
        data: {
          type: 'bb_workspace--bb_workspace',
          id: uuid,
          attributes: { name: 'hijacked' },
        },
      },
    });
    expect(response.status()).toBe(403);
  },
);

Given('its credentials have issued an access token', async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/oauth/token`, {
    form: {
      grant_type: 'client_credentials',
      client_id: issuedKey!.clientId,
      client_secret: issuedKey!.secret,
    },
  });
  expect(response.ok()).toBe(true);
  accessToken = (await response.json()).access_token;
});

When('I revoke that key through the user area', async ({ page }) => {
  await page.goto(`/user/${ownerUid()}/api-keys`);
  const row = page.locator('li', { hasText: issuedKey!.clientId });
  await row.getByRole('link', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // Revoked here, through the UI — the afterEach cleanup no longer needs to
  // (and by then cannot) delete this one.
  const index = createdClientIds.indexOf(issuedKey!.clientId);
  if (index !== -1) {
    createdClientIds.splice(index, 1);
  }
});

When('I visit the full-page API key creation form', async ({ page }) => {
  await page.goto(`/user/${ownerUid()}/api-keys/add`);
});

When(
  'I fill in the full-page form with name {string} expiring in {int} days',
  async ({ page }, label: string, days: number) => {
    await page.getByLabel('Name').fill(label);
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + days);
    await page.getByLabel('Expires').fill(expires.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Create API key' }).click();
    await expect(page.getByRole('button', { name: 'Copy the secret' })).toBeVisible();
    const clientId = await commandText(page, 'Copy the client ID');
    createdClientIds.push(clientId);
    issuedKey = { clientId, secret: await commandText(page, 'Copy the secret') };
  },
);

When('I follow the Done link', async ({ page }) => {
  await page.getByRole('link', { name: 'Done' }).click();
});

Then('that access token is rejected on the next API request', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/user/${ownerUid()}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status()).toBe(401);
});

Then('its client credentials cannot issue another token', async ({ request, baseURL }) => {
  const response = await request.post(`${baseURL}/oauth/token`, {
    form: {
      grant_type: 'client_credentials',
      client_id: issuedKey!.clientId,
      client_secret: issuedKey!.secret,
    },
  });
  expect(response.status()).toBe(401);
});

let otherResponseStatus: number | undefined;
let anonymousUrl: string | undefined;

When('another authenticated user visits my API keys page', async ({ page, authProvider }) => {
  const otherPage = await page.context().browser()!.newContext().then((context) => context.newPage());
  await authProvider.login(otherPage, uidOf('other-member'));
  const response = await otherPage.goto(`/user/${ownerUid()}/api-keys`);
  otherResponseStatus = response?.status();
  await otherPage.close();
});

Then('they receive a {int}', ({}, status: number) => {
  expect(otherResponseStatus).toBe(status);
});

When('an anonymous visitor visits my API keys page', async ({ browser }) => {
  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(`/user/${ownerUid()}/api-keys`);
  anonymousUrl = anonymousPage.url();
  await anonymousPage.close();
});

Then('they are redirected to the login form', () => {
  expect(anonymousUrl).toContain('/user/login');
});
