// Workspace Service Accounts: a workspace administrator creates/rotates/
// revokes/disables a dedicated automation identity through the real
// settings tab, with the same one-time-reveal/no-store contract as personal
// API keys (see support/steps/api-keys.steps.ts). Every scenario builds its
// own disposable workspace, team and administrator, owned by a throwaway
// account — a shared fixture workspace must not accumulate leftover service
// users across runs (see steps/settings/settings-tabs.steps.ts for the same
// convention).
import { randomUUID } from 'node:crypto';
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';
import { php, phpWithRetry } from '../../support/drush';

const { Given, When, Then, After } = createBdd(test);

interface ServiceAccountsWorld {
  slug: string;
  adminUid: string;
  memberUid: string;
  memberUuid: string;
  projectUuid: string;
}

interface IssuedServiceAccount {
  name: string;
  clientId: string;
  secret: string;
}

let world: ServiceAccountsWorld | undefined;
let issued: IssuedServiceAccount | undefined;
let accessToken: string | undefined;
let requestStatus = 0;

async function removeWorld(slug: string): Promise<void> {
  // shortcut: retries MySQL 1412 in teardown; the concurrent cache_entity DDL is unidentified — find and serialize it if 1412 appears outside teardown.
  await phpWithRetry(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));`,
      'if ($w) {',
      'foreach ($etm->getStorage("bb_group")->loadByProperties(["workspace_id" => $w->id()]) as $g) {',
      'foreach ($etm->getStorage("bb_project")->loadByProperties(["group_id" => $g->id()]) as $p) {',
      'foreach ($etm->getStorage("bb_ticket")->loadByProperties(["project_id" => $p->id()]) as $tk) { $tk->delete(); }',
      '$p->delete(); }',
      '$g->delete(); }',
      // A service account can never be deleted through the entity API
      // (ServiceAccountHooks::userPredelete() fails closed by design —
      // Disable is the sole lifecycle operation); this scenario-only
      // cleanup removes its keys and memberships, then purges the raw rows
      // instead of leaving a blocked account behind for every test run.
      'foreach ($etm->getStorage("user")->getQuery()->accessCheck(FALSE)->condition("bb_service_workspace", $w->id())->execute() as $uid) {',
      'foreach ($etm->getStorage("consumer")->loadByProperties(["owner_id" => $uid]) as $c) { $c->delete(); }',
      '$u = $etm->getStorage("user")->load($uid);',
      'foreach (\\Drupal\\og\\Og::getMemberships($u, \\Drupal\\og\\OgMembershipInterface::ALL_STATES) as $m) { $m->delete(); }',
      '\\Drupal::database()->delete("users")->condition("uid", $uid)->execute();',
      '\\Drupal::database()->delete("users_field_data")->condition("uid", $uid)->execute();',
      '$etm->getStorage("user")->resetCache([$uid]);',
      '}',
      'foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]) as $t) { $t->delete(); }',
      '$admin = $w->get("owner_user_id")->target_id;',
      '$w->delete();',
      'if ($admin) { $etm->getStorage("user")->load($admin)?->delete(); }',
      `$etm->getStorage("user")->load(current($etm->getStorage("user")->getQuery()->accessCheck(FALSE)->condition("name", "${slug}-member")->execute()) ?: 0)?->delete(); }`,
    ].join(' '),
    ['1412 Table definition has changed'],
  );
}

After({ tags: '@feature:service-accounts' }, async () => {
  if (!world) return;
  const { slug } = world;
  world = undefined;
  issued = undefined;
  accessToken = undefined;
  await removeWorld(slug);
});

Given('I lead a disposable service-accounts workspace', async () => {
  const suffix = randomUUID().slice(0, 8);
  const slug = `svc-acct-${suffix}`;
  const out = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$admin = $etm->getStorage("user")->create(["name" => "${slug}-admin", "status" => 1, "field_onboarding_completed" => TRUE]); $admin->save();`,
      `$member = $etm->getStorage("user")->create(["name" => "${slug}-member", "status" => 1, "field_onboarding_completed" => TRUE]); $member->save();`,
      `$w = $etm->getStorage("bb_workspace")->create(["name" => "Service accounts ${suffix}", "slug" => "${slug}", "owner_user_id" => $admin->id()]); $w->save();`,
      `$t = $etm->getStorage("bb_team")->create(["name" => "Service accounts team ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $admin->id()]); $t->save();`,
      // `og.settings.auto_add_group_owner_membership` already created a
      // membership for $admin on $w->save() (it is the workspace's
      // owner_user_id): upsert, do not createMembership() a second one.
      '($m = \\Drupal\\og\\Og::getMembership($w, $admin, \\Drupal\\og\\OgMembershipInterface::ALL_STATES)) ?? ($m = \\Drupal\\og\\Og::createMembership($w, $admin)); $m->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-lead")])->setState(\\Drupal\\og\\OgMembershipInterface::STATE_ACTIVE)->save();',
      '\\Drupal\\og\\Og::createMembership($w, $member)->save();',
      // The team's project: the only place this team's Reporter may file.
      `$g = $etm->getStorage("bb_group")->create(["name" => "Service accounts group ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $admin->id()]); $g->save();`,
      `$p = $etm->getStorage("bb_project")->create(["name" => "Service accounts project ${suffix}", "group_id" => $g->id(), "teams" => [$t->id()]]); $p->save();`,
      '\\Drupal::service("cache.static")->deleteAll();',
      'print json_encode(["admin" => $admin->id(), "member" => $member->id(), "memberUuid" => $member->uuid(), "project" => $p->uuid()]);',
    ].join(' '),
  );
  const parsed = JSON.parse(out) as { admin: number; member: number; memberUuid: string; project: string };
  world = {
    slug,
    adminUid: String(parsed.admin),
    memberUid: String(parsed.member),
    memberUuid: parsed.memberUuid,
    projectUuid: parsed.project,
  };
});

function requireWorld(): ServiceAccountsWorld {
  if (!world) throw new Error('No disposable service-accounts workspace was built.');
  return world;
}

function servicedAccountsPath(): string {
  return `/${requireWorld().slug}/settings/service-accounts`;
}

Given('I am signed in as the workspace administrator', async ({ page, authProvider }) => {
  await authProvider.login(page, requireWorld().adminUid);
});

Given('I am signed in as an ordinary member of that workspace', async ({ page, authProvider }) => {
  await authProvider.login(page, requireWorld().memberUid);
});

Given('I am signed in as a member of a different workspace', async ({ page, authProvider, apiClient }) => {
  const uid = php(
    `$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${apiClient.fixtureId('user.foreign')}"); print $a ? $a->id() : "";`,
  );
  expect(uid, 'no account fixture user.foreign').not.toBe('');
  await authProvider.login(page, uid);
});

Given('I am signed out', async () => {
  // No login call: the shared `page` fixture starts each scenario anonymous.
});

When('I open the Service Accounts settings screen', async ({ page }) => {
  const response = await page.goto(servicedAccountsPath());
  expect(response?.status() ?? 0, 'the Service Accounts screen did not render').toBeLessThan(400);
});

When('I open the Service Accounts settings screen again', async ({ page }) => {
  const response = await page.goto(servicedAccountsPath());
  expect(response?.status() ?? 0, 'the Service Accounts screen did not render on the second visit').toBeLessThan(400);
});

When('I request the Service Accounts settings screen', async ({ page }) => {
  const response = await page.goto(servicedAccountsPath());
  requestStatus = response?.status() ?? 0;
});

Then('access to the Service Accounts settings screen is denied', () => {
  expect(requestStatus).toBe(403);
});

Then('I am redirected to the login form', ({ page }) => {
  expect(page.url()).toContain('/user/login');
});

/**
 * Clicks a dialog trigger only once htmx has actually processed it.
 *
 * The trigger is a real `<a href>`; a click before htmx attaches its
 * listener navigates to the full-page fallback route instead of opening the
 * dialog (see group-team-create.steps.ts's `open()` for the same guard).
 */
async function clickDialogTrigger(trigger: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(trigger).toBeVisible();
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      message: 'htmx never processed the dialog trigger',
      timeout: 20000,
    })
    .toBe(true);
  await trigger.click();
}

async function createThroughDialog(page: Page, label: string, days: number): Promise<IssuedServiceAccount> {
  await page.goto(servicedAccountsPath());
  await clickDialogTrigger(page.getByRole('link', { name: 'Create service account' }).first());
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(label);
  await dialog.getByLabel('Key name').fill(label);
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + days);
  await dialog.getByLabel('Expires').fill(expires.toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Create service account' }).click();
  const result = page.locator('dialog[open]');
  await expect(result.getByRole('button', { name: 'Copy the secret' })).toBeVisible();
  return {
    name: label,
    clientId: await commandText(result, 'Copy the client ID'),
    secret: await commandText(result, 'Copy the secret'),
  };
}

/**
 * Reads the command text out of a `setup_command` copy item, located by its
 * Copy control's accessible label — same shape as personal API keys'
 * ApiKeyCreateForm::buildResult().
 */
async function commandText(scope: Page | ReturnType<Page['locator']>, label: string): Promise<string> {
  return scope
    .locator(`xpath=.//div[@x-data][.//button[@aria-label="${label}"]]//code`)
    .innerText();
}

When(
  'I create a service account named {string} expiring in {int} days',
  async ({ page }, label: string, days: number) => {
    issued = await createThroughDialog(page, label, days);
  },
);

Given(
  'I have created a service account named {string} through the Service Accounts screen',
  async ({ page }, label: string) => {
    issued = await createThroughDialog(page, label, 90);
  },
);

Then("the created service account's client ID and secret are shown", async ({ page }) => {
  expect(issued!.clientId).toMatch(/^bakers-key-/);
  expect(issued!.secret.length).toBeGreaterThan(20);
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('shown once');
});

When('I close the service account dialog', async ({ page }) => {
  await page.locator('dialog[open]').getByRole('link', { name: 'Done' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

function accountRow(page: Page) {
  // Each disposable per-scenario workspace only ever holds the one service
  // account this scenario creates, so the single row of the Service
  // Accounts `bb_theme:list` IS that account. Neither the client ID (gone
  // after Disable revokes every key) nor the generated name (server-
  // truncated to a short ellipsis in the row) is a reliable row-matching
  // text across this feature's whole lifecycle; sidebar navigation also
  // uses plain `<li>` elements, so the list must be scoped explicitly.
  return page.locator('[data-component-id="bb_theme:list"] > li').first();
}

Then('the service account is listed as active without its secret', async ({ page }) => {
  await page.goto(servicedAccountsPath());
  const row = accountRow(page);
  await expect(row).toContainText('Active');
  await expect(page.locator('body')).not.toContainText(issued!.secret);
});

/**
 * Opens the row's action menu and picks one action.
 *
 * Create API key, Revoke and Disable live in a `bb_theme:action_menu`: menu items,
 * hidden until its trigger discloses them. They are plain links (no htmx
 * dialog wiring, unlike the page-header "Create service account" plus), so
 * each opens its full-page form, never a modal.
 */
async function pickRowAction(page: Page, name: string | RegExp): Promise<void> {
  const row = accountRow(page);
  await row.getByLabel(/^Actions for /).click();
  await row.getByRole('menuitem', { name }).first().click();
}

/** Counts a row action, including ones inside the closed menu. */
function rowActions(page: Page, name: string | RegExp) {
  return accountRow(page).getByRole('menuitem', { name, includeHidden: true });
}

/**
 * Opens the account's API keys page through its row menu.
 *
 * It is the same list a person sees for their own keys, at
 * /user/{uid}/api-keys: one row per key with its own Revoke.
 */
async function openKeysPage(page: Page): Promise<void> {
  await page.goto(servicedAccountsPath());
  await pickRowAction(page, 'Manage API keys');
  await expect(page).toHaveURL(/\/user\/\d+\/api-keys/);
}

function revokeLinks(page: Page) {
  return page.getByRole('link', { name: 'Revoke', exact: true });
}

When('I issue a second API key for that service account', async ({ page }) => {
  await openKeysPage(page);
  await clickDialogTrigger(page.getByRole('link', { name: 'Create API key' }).first());
  await page.getByLabel('Key name').fill('rotation');
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + 30);
  await page.getByLabel('Expires').fill(expires.toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Create API key' }).click();
  await expect(page.getByRole('button', { name: 'Copy the secret' })).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();
  await page.waitForLoadState('load');
});

Then('the service account lists two keys', async ({ page }) => {
  await openKeysPage(page);
  await expect(revokeLinks(page)).toHaveCount(2);
});

When('I revoke the first key of that service account', async ({ page }) => {
  await openKeysPage(page);
  await revokeLinks(page).first().click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // The submit returns to the Service Accounts list; later checks must not race it.
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
});

Then('the service account lists exactly one key', async ({ page }) => {
  await openKeysPage(page);
  await expect(revokeLinks(page)).toHaveCount(1);
});

When('I disable that service account', async ({ page }) => {
  await page.goto(servicedAccountsPath());
  await pickRowAction(page, 'Disable');
  await page.getByRole('button', { name: 'Disable' }).click();
  // The API checks that follow must not race the submit.
  await expect(accountRow(page)).toContainText('Disabled');
});

const POSITION_LABEL = 'Position';
const BACKGROUND_LABEL = 'What should bakers.build know about your background?';

/** Opens the account's Profile page through its row menu. */
async function openProfilePage(page: Page): Promise<void> {
  await page.goto(servicedAccountsPath());
  await pickRowAction(page, 'Profile');
  await expect(page).toHaveURL(/\/user\/\d+\/profile/);
}

When(
  "I save the service account's profile with position {string} and background {string}",
  async ({ page }, position: string, background: string) => {
    await openProfilePage(page);
    await page.getByLabel(POSITION_LABEL, { exact: true }).fill(position);
    await page.getByLabel(BACKGROUND_LABEL).fill(background);
    await page.getByRole('button', { name: 'Save' }).click();
    // Saving returns to the Service Accounts list.
    await expect(page).toHaveURL(/\/settings\/service-accounts/);
  },
);

Then(
  "the service account's profile shows position {string} and background {string}",
  async ({ page }, position: string, background: string) => {
    await openProfilePage(page);
    await expect(page.getByLabel(POSITION_LABEL, { exact: true })).toHaveValue(position);
    await expect(page.getByLabel(BACKGROUND_LABEL)).toHaveValue(background);
  },
);

Then('the service account is listed as disabled', async ({ page }) => {
  await page.goto(servicedAccountsPath());
  await expect(accountRow(page)).toContainText('Disabled');
});

Then('the service account offers no Manage API keys or Disable action', async ({ page }) => {
  await page.goto(servicedAccountsPath());
  await expect(rowActions(page, 'Manage API keys')).toHaveCount(0);
  await expect(rowActions(page, 'Disable')).toHaveCount(0);
});

When(
  'I create a service account named {string} through the full-page form',
  async ({ page }, label: string) => {
    await page.goto(servicedAccountsPath());
    // Without JavaScript the page-header plus is a plain link to the
    // full-page fallback form.
    await page.getByRole('link', { name: 'Create service account' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill(label);
    await page.getByLabel('Key name').fill(label);
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + 90);
    await page.getByLabel('Expires').fill(expires.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Create service account' }).click();
    await expect(page.getByRole('button', { name: 'Copy the secret' })).toBeVisible();
    issued = {
      name: label,
      clientId: await commandText(page, 'Copy the client ID'),
      secret: await commandText(page, 'Copy the secret'),
    };
  },
);

Then('the service account credentials are shown on the page', async ({ page }) => {
  expect(issued!.clientId).toMatch(/^bakers-key-/);
  expect(issued!.secret.length).toBeGreaterThan(20);
  await expect(page.locator('body')).toContainText('shown once');
});

async function mintToken(request: import('@playwright/test').APIRequestContext, baseURL: string | undefined) {
  return request.post(`${baseURL}/oauth/token`, {
    form: {
      grant_type: 'client_credentials',
      client_id: issued!.clientId,
      client_secret: issued!.secret,
    },
  });
}

When("the service account's credentials are exchanged for an access token", async ({ request, baseURL }) => {
  const response = await mintToken(request, baseURL);
  expect(response.ok(), 'the issued key must mint a token').toBe(true);
  accessToken = (await response.json()).access_token;
});

function serviceUserUuid(): string {
  return php(
    `$c = current(\\Drupal::entityTypeManager()->getStorage("consumer")->loadByProperties(["client_id" => "${issued!.clientId}"]));` +
      ' print $c ? $c->get("owner_id")->entity->uuid() : "";',
  );
}

Then(
  "a ticket filed with that token in the team's project is authored by the service account and assigned to the member",
  async ({ request, baseURL }) => {
    const { projectUuid, memberUuid } = requireWorld();
    const response = await request.post(`${baseURL}/jsonapi/bb_ticket/bb_ticket`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      data: {
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: {
            title: 'E2E incident',
            workflow: 'bb_work',
            description: { value: 'Scheduled run failed.', format: 'bb_rich' },
          },
          relationships: {
            project_id: { data: { type: 'bb_project--bb_project', id: projectUuid } },
            assignee_user_id: { data: { type: 'user--user', id: memberUuid } },
          },
        },
      },
    });
    expect(response.status()).toBe(201);
    const ticket = (await response.json()).data;
    expect(ticket.relationships.owner_user_id.data.id).toBe(serviceUserUuid());
    expect(ticket.relationships.assignee_user_id.data.id).toBe(memberUuid);
  },
);

Then("the service account's access token is rejected on the next API request", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/jsonapi/bb_project/bb_project/${requireWorld().projectUuid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status()).toBe(401);
});

Then("the service account's credentials cannot issue another token", async ({ request, baseURL }) => {
  const response = await mintToken(request, baseURL);
  expect(response.status()).toBe(401);
});
