// The Members settings screen's invite dialog, exercised end to end: open it
// through the page header's "Invite members" action, fill the e-mail textarea,
// pick in the role and team pills, submit, and read the mails Mailpit actually
// received. `invitation.feature` seeds its invitation through the service; this
// feature is the other half, proving the dialog is what creates one.
import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { test, expect } from '../../bdd.fixtures';
import { messagesFor, clearMailboxFor } from '../../support/login-flow';
import { optionRow, pickerPanel, pickerTrigger, waitForPickerBehaviour } from '../../support/picker';
import { MEMBERS_ISLAND, markDocument } from '../../support/shell';
import type { Page } from '@playwright/test';

const { Given, When, Then, After } = createBdd(test);

/** The addresses entered in this scenario, unique per run for the same reason
 * `invitation.steps.ts`'s `invitedAddress` is: a fixed address is skipped as
 * "already invited" on a second run. */
let invitedAddresses: string[] = [];

/** The first entered address, which the single-address steps are about. */
let invitedAddress = '';

/** The text typed into the textarea, to prove a refusal keeps it. */
let typedText = '';

/** The open invite dialog, by the form it hosts. */
const DIALOG = 'dialog[data-dialog]:has(form#bb-workspace-invite-form)';

/** The status the Members screen answered the last direct request with. */
let requestStatus = 0;

/**
 * The workspace `user.lead` actually leads: `workspace.home`, resolved by
 * fixture id rather than by guessing a slug. `settings-tabs.steps.ts`'s
 * `project.home` is scoped the same way and for the same reason — a
 * hardcoded slug would couple this scenario to which workspace the seed
 * happens to insert first, and `workspace.home` is not necessarily the one
 * slugged "bakers".
 */
function workspaceSettingsMembersPath(apiClient: { fixtureId(name: string): string }): string {
  const uuid = apiClient.fixtureId('workspace.home');
  const slug = Drush.exec(
    `php:eval '$w = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_workspace", "${uuid}"); if (!$w) { throw new \\RuntimeException("Missing fixture workspace.home"); } print $w->get("slug")->value;'`,
  ).trim();
  if (!slug) {
    throw new Error('No slug for the workspace.home fixture.');
  }
  return `/${slug}/settings/members`;
}

When('I open the workspace Members settings screen', async ({ page, apiClient }) => {
  const response = await page.goto(workspaceSettingsMembersPath(apiClient));
  expect(response?.status() ?? 0, 'the Members settings screen did not render').toBeLessThan(400);
  await markDocument(page);
});

When('I open the workspace Members settings screen again', async ({ page, apiClient }) => {
  const response = await page.goto(workspaceSettingsMembersPath(apiClient));
  expect(response?.status() ?? 0, 'the Members settings screen did not render on the second visit').toBeLessThan(400);
  await markDocument(page);
});

/**
 * The uid behind a recipe account fixture, or an error naming the fixture.
 */
function uidOfFixture(apiClient: { fixtureId(name: string): string }, fixture: string): string {
  const uuid = apiClient.fixtureId(fixture);
  const uid = Drush.exec(
    `php:eval '$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${uuid}"); print $a ? $a->id() : "";'`,
  ).trim();
  if (!uid) {
    throw new Error(`No account for the fixture ${fixture}.`);
  }
  return uid;
}

/** The OG role ids `uid` holds in `workspace.home`, or "none" without a membership. */
function homeRolesOf(apiClient: { fixtureId(alias: string): string }, uid: number | string): string {
  const workspace = apiClient.fixtureId('workspace.home');
  return Drush.exec(
    `php:eval '$w = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_workspace", "${workspace}"); ` +
      `$m = \\Drupal::service("og.membership_manager")->getMembership($w, ${uid}); ` +
      `print $m ? implode(",", $m->getRolesIds()) : "none";'`,
  ).trim();
}

/**
 * `user.workspace-only` belongs to `workspace.home` without a role. That is
 * asserted rather than assumed, so a seed that promotes the account fails
 * here instead of passing the 403 scenario for the wrong reason.
 */
Given('I am signed in as a workspace member who does not lead it', async ({ page, authProvider, apiClient }) => {
  const uid = uidOfFixture(apiClient, 'user.workspace-only');
  const roles = homeRolesOf(apiClient, uid);
  expect(roles, 'user.workspace-only is not a member of workspace.home').not.toBe('none');
  expect(roles, 'user.workspace-only leads workspace.home').not.toContain('lead');
  await authProvider.login(page, uid);
});

When('I request the workspace Members settings screen', async ({ page, apiClient }) => {
  const response = await page.goto(workspaceSettingsMembersPath(apiClient));
  requestStatus = response?.status() ?? 0;
});

Then('access to the Members settings screen is denied', async () => {
  expect(requestStatus).toBe(403);
});

// The fresh addresses a scenario invited, so the shared Members list does not grow per run.
After(async () => {
  const fresh = invitedAddresses.filter((address) => address.startsWith('bakers-members-invite-'));
  invitedAddresses = [];
  if (fresh.length === 0) return;
  Drush.exec(
    `php:eval '$s = \\Drupal::entityTypeManager()->getStorage("bb_invite"); $s->delete($s->loadByProperties(["email" => ${JSON.stringify(fresh)}]));'`,
  );
});

/** A fresh address, unique per run. */
function freshAddress(n: number): string {
  return `bakers-members-invite-${Date.now()}-${n}@example.com`;
}

/**
 * Opens the dialog through the page header's action, waiting for htmx to own
 * the trigger first: the anchor carries a real `href`, so an early click would
 * navigate to the standalone form instead (see project-create.steps.ts).
 */
When('I open the invite dialog', async ({ page }) => {
  const trigger = page.getByRole('link', { name: 'Invite members', exact: true });
  await expect(trigger, 'no "Invite members" action on the Members screen').toBeAttached();
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      message: 'htmx never processed the invite trigger',
      timeout: 20000,
    })
    .toBe(true);
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await trigger.click();
  await answered;
  await expect(page.locator(DIALOG), 'the invite dialog did not open').toBeVisible();
});

Then(
  'the invite dialog opens on the workspace role {string} and the team {string}',
  async ({ page }, role: string, team: string) => {
    await expect(pickerTrigger(page, DIALOG, 'Workspace role')).toContainText(role);
    await expect(pickerTrigger(page, DIALOG, 'Team')).toContainText(team);
  },
);

Then('the workspace role {string} is explained as {string}', async ({ page }, role: string, description: string) => {
  const trigger = pickerTrigger(page, DIALOG, 'Workspace role');
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  const row = optionRow(page, pickerPanel(trigger), role);
  await expect(row.locator('.option-list__description')).toHaveText(description);
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG), 'Escape on the panel must not close the dialog').toBeVisible();
});

/** Types the addresses into the textarea and remembers them. */
async function enterAddresses(page: Page, baseURL: string, addresses: string[], extra = ''): Promise<void> {
  invitedAddresses = addresses;
  invitedAddress = addresses[0] ?? '';
  for (const address of addresses) {
    await clearMailboxFor(page, baseURL, address);
  }
  typedText = [...addresses, ...(extra ? [extra] : [])].join('\n');
  // The chips input commits on Enter; the hidden textarea is what the form submits.
  const input = addressInput(page);
  await input.fill(typedText.replaceAll('\n', ', '));
  await input.press('Enter');
}

/** The invite dialog's address input: the chips field's text input. */
function addressInput(page: Page) {
  return page.locator(DIALOG).getByRole('textbox', { name: 'Email addresses' });
}

/** The chips the invite dialog shows, one list item per entered address. */
function addressChips(page: Page) {
  return page.locator(`${DIALOG} [data-email-chips]`).getByRole('listitem');
}

When('I type {string} into the invite addresses', async ({ page }, text: string) => {
  await addressInput(page).focus();
  await page.keyboard.type(text);
});

Then('the invite addresses show the chips {string}', async ({ page }, list: string) => {
  const addresses = list.split(',').map((address) => address.trim());
  await expect(addressChips(page).locator('[data-email-chips-address]')).toHaveText(addresses);
  await expect(page.locator(`${DIALOG} textarea[name="emails"]`)).toHaveValue(addresses.join('\n'));
});

Then('the invite addresses show no chips', async ({ page }) => {
  await expect(addressChips(page)).toHaveCount(0);
  await expect(page.locator(`${DIALOG} textarea[name="emails"]`)).toHaveValue('');
});

Then('the chip {string} is marked as not an e-mail address', async ({ page }, address: string) => {
  const chip = addressChips(page).filter({ hasText: address });
  await expect(chip).toContainText('Not an e-mail address');
  await expect(chip).toHaveAttribute('data-invalid', '');
});

When('I remove the chip {string}', async ({ page }, address: string) => {
  const remove = addressChips(page).getByRole('button', { name: `Remove ${address}`, exact: true });
  await remove.focus();
  await page.keyboard.press('Enter');
});

Then('the invite addresses field has focus', async ({ page }) => {
  await expect(addressInput(page)).toBeFocused();
});

When('I enter two fresh, never-used e-mail addresses', async ({ page, baseURL }) => {
  await enterAddresses(page, baseURL!, [freshAddress(1), freshAddress(2)]);
});

/** Keyboard only: types into whatever has focus, as a user would. */
When('I type two fresh, never-used e-mail addresses', async ({ page }) => {
  invitedAddresses = [freshAddress(1), freshAddress(2)];
  invitedAddress = invitedAddresses[0];
  await page.keyboard.type(invitedAddresses.join(', '));
});

When('I enter one fresh, never-used e-mail address', async ({ page, baseURL }) => {
  await enterAddresses(page, baseURL!, [freshAddress(1)]);
});

When('I enter a fresh address and the entry {string}', async ({ page, baseURL }, entry: string) => {
  await enterAddresses(page, baseURL!, [freshAddress(1)], entry);
});

When('I enter the address of an existing member', async ({ page, baseURL, apiClient }) => {
  const uid = uidOfFixture(apiClient, 'user.member');
  expect(homeRolesOf(apiClient, uid), 'user.member is not a member of workspace.home').not.toBe('none');
  const address = Drush.exec(`php:eval 'print \\Drupal\\user\\Entity\\User::load(${uid})->getEmail();'`).trim();
  expect(address, 'user.member has no mail address').toContain('@');
  await enterAddresses(page, baseURL!, [address]);
});

When('I pick the workspace role {string}', async ({ page }, role: string) => {
  const trigger = pickerTrigger(page, DIALOG, 'Workspace role');
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await optionRow(page, pickerPanel(trigger), role).click();
  await expect(trigger).toContainText(role);
});

/** Rewrites the pill's hidden input, so the request is the dialog's own POST. */
When('I forge the workspace role {string}', async ({ page }, roleId: string) => {
  const input = page.locator(`${DIALOG} input[type="hidden"][name="workspace_role"]`);
  await expect(input, 'the role pill carries no hidden input').toHaveCount(1);
  await input.evaluate((el, value) => {
    (el as HTMLInputElement).value = value;
  }, roleId);
});

When('I submit the invite dialog', async ({ page }) => {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST', { timeout: 20000 });
  await page.locator(DIALOG).getByRole('button', { name: 'Invite', exact: true }).click();
  await answered;
});

When('I cancel the invite dialog', async ({ page }) => {
  await page.locator(DIALOG).getByRole('link', { name: 'Cancel', exact: true }).click();
});

Then('the invite dialog is closed', async ({ page }) => {
  await expect(page.locator(DIALOG)).toHaveCount(0, { timeout: 20000 });
});

/** The result toast: fixed, so the list underneath does not move. */
Then('the Members screen confirms {string}', async ({ page }, text: string) => {
  await expect(page.locator('[data-component-id="bb_theme:toast"]').getByText(text)).toBeVisible({ timeout: 20000 });
});

Then('members and invitations share one list', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toHaveCount(0);
  const roster = page.locator(`${MEMBERS_ISLAND} ul[role="list"]:has(> li[data-list-item])`);
  await expect(roster).toHaveCount(1);
  await expect(roster.locator('> li').filter({ hasText: invitedAddress })).toBeVisible();
});

Then('the Members screen still lists its members', async ({ page }) => {
  await expect(page.locator(`${MEMBERS_ISLAND} ul[role="list"] > li[data-list-item]`).first()).toBeVisible();
});

Then(
  'each invited address is listed as pending with the role {string} and the team {string}',
  async ({ page }, role: string, team: string) => {
    for (const address of invitedAddresses) {
      const row = page.locator(`${MEMBERS_ISLAND} li[data-list-item]`).filter({ hasText: address }).first();
      await expect(row, `${address} is not listed as pending`).toBeVisible();
      await expect(row).toContainText(role);
      await expect(row).toContainText(team);
      await expect(row).toContainText('Invited');
    }
  },
);

Then('exactly one invitation mail reaches each invited address', async ({ page, baseURL }) => {
  for (const address of invitedAddresses) {
    await expect.poll(async () => (await messagesFor(page, baseURL!, address)).length).toBe(1);
  }
});

When('I revoke the pending invitation of the first invited address', async ({ page }) => {
  // Revoking asks for confirmation in the delete dialog, which then closes in
  // place and the list re-renders without a page load.
  const revoke = page.getByRole('link', { name: `Revoke invitation for ${invitedAddress}` });
  // A click before htmx owns the anchor would follow its page href instead.
  await expect
    .poll(() => revoke.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      message: 'htmx never processed the Revoke action',
      timeout: 20000,
    })
    .toBe(true);
  await revoke.click();
  const dialog = page.locator('dialog[data-dialog][open]:has(form[id$="-delete-form"])');
  await expect(dialog).toBeVisible();
  const answered = page.waitForResponse((response) => response.request().method() === 'POST', { timeout: 20000 });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await answered;
  await expect(dialog, 'the revoke dialog did not close').toHaveCount(0, { timeout: 20000 });
});

When('I move focus to the revoke of the first invited address', async ({ page }) => {
  const revoke = page.getByRole('link', { name: `Revoke invitation for ${invitedAddress}` });
  // Enter on it must open the dialog, not follow the page link.
  await expect
    .poll(() => revoke.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      timeout: 20000,
    })
    .toBe(true);
  await revoke.focus();
});

Then('the revoke confirmation is open', async ({ page }) => {
  await expect(page.locator('dialog[data-dialog][open]:has(form[id$="-delete-form"])')).toBeVisible({ timeout: 20000 });
});

Then('the invite dialog Invite has focus', async ({ page }) => {
  await expect(page.locator(DIALOG).getByRole('button', { name: 'Invite', exact: true })).toBeFocused();
});

Then('the revoke confirmation Delete has focus', async ({ page }) => {
  await expect(page.locator('dialog[data-dialog][open]').getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
});

Then('the revoke confirmation Cancel has focus', async ({ page }) => {
  await expect(page.locator('dialog[data-dialog][open] [data-dialog-cancel]')).toBeFocused();
});

Then('the screen reader hears the revoke of the first invited address', async ({ page }) => {
  await expect(page.locator('#drupal-live-announce')).toContainText(`Revoked the invitation for ${invitedAddress}.`);
});

Then('the first invited address is no longer listed as a pending invitation', async ({ page }) => {
  await expect(page.getByRole('link', { name: `Revoke invitation for ${invitedAddress}` })).toHaveCount(0);
  expect(inviteCount(invitedAddress)).toBe('0');
  expect(inviteCount(invitedAddresses[1])).toBe('1');
});

Then('the invite dialog marks the addresses as refused and keeps them', async ({ page }) => {
  await expect(addressInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`${DIALOG} textarea[name="emails"]`)).toHaveValue(typedText);
  await expect(addressChips(page)).toHaveCount(typedText.split('\n').length);
});

Then('the invite dialog names {string} as not an e-mail address', async ({ page }, entry: string) => {
  await expect(page.locator(DIALOG)).toContainText(`Not an e-mail address: ${entry}`);
});

Then('the invite dialog refuses the workspace role', async ({ page }) => {
  await expect(page.locator(DIALOG)).toContainText('Choose a workspace role this workspace offers.');
});

Then("the existing member's address is not listed as a pending invitation", async ({ page }) => {
  await expect(page.getByRole('link', { name: `Revoke invitation for ${invitedAddress}` })).toHaveCount(0);
});

Then('no invitation mail reaches the existing member', async ({ page, baseURL }) => {
  // Mail is sent synchronously on submit, so a short grace period suffices.
  await page.waitForTimeout(3000);
  expect(await messagesFor(page, baseURL!, invitedAddress)).toHaveLength(0);
});

Then('no invitation exists for that address', async () => {
  expect(inviteCount(invitedAddress)).toBe('0');
});

Then('no invitation mail reaches that address', async ({ page, baseURL }) => {
  await page.waitForTimeout(3000);
  expect(await messagesFor(page, baseURL!, invitedAddress)).toHaveLength(0);
});

/** How many invitations the store holds for an address. */
function inviteCount(address: string): string {
  return Drush.exec(
    `php:eval 'print count(\\Drupal::entityTypeManager()->getStorage("bb_invite")->loadByProperties(["email" => "${address}"]));'`,
  ).trim();
}

When('I move focus to Invite members', async ({ page }) => {
  const trigger = page.locator('#members-invite');
  // Enter on it must open the dialog, not follow the page link.
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      timeout: 20000,
    })
    .toBe(true);
  await trigger.focus();
});

Then('the invite dialog is open', async ({ page }) => {
  await expect(page.locator(DIALOG)).toBeVisible({ timeout: 20000 });
});

/** The `Invite members` trigger, where focus returns after its dialog. */
Then('Invite members has focus', async ({ page }) => {
  await expect(page.locator('#members-invite')).toBeFocused();
});

/** The fixture workspace's owner, whose removal the face refuses. */
function workspaceOwnerUid(apiClient: { fixtureId(name: string): string }): string {
  const uuid = apiClient.fixtureId('workspace.home');
  return Drush.exec(
    `php:eval '$w = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_workspace", "${uuid}"); print $w ? $w->getOwnerId() : "";'`,
  ).trim();
}

When('I press remove for the workspace owner', async ({ page, apiClient }) => {
  const answered = page.waitForResponse((response) => response.request().method() === 'POST', { timeout: 15000 });
  await page.locator(`#members-remove-${workspaceOwnerUid(apiClient)}`).click();
  await answered;
});

Then('the remove control of the workspace owner has focus', async ({ page, apiClient }) => {
  await expect(page.locator(`#members-remove-${workspaceOwnerUid(apiClient)}`)).toBeFocused();
});
