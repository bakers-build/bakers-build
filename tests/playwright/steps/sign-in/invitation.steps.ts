// A workspace invitation carries a person all the way in.
//
// Both scenarios in features/sign-in/invitation.feature start from a mail
// Mailpit actually delivered: the invitation, sent by
// `WorkspaceInvite::invite()` when the fixture below is seeded. Nothing here
// hand-builds the join URL — it is read out of the mail body, the same way
// `login-flow.ts`'s `loginLinkFor()` reads the one-time login link out of
// core's mail rather than reconstructing it.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { php } from '../../support/drush';
import { clearLoginFloodFor, clearMailboxFor, loginCodeFor, messagesFor, bodyOf, submitAddress, submitLoginCode } from '../../support/login-flow';

/** The address seeded for the current scenario, one per invitation. */
let invitedAddress = '';

/**
 * Seeds a real invitation the way the Members island does: through
 * `WorkspaceInvite::invite()`, so the mail this feature reads is the actual
 * product mail and not a hand-built stand-in.
 *
 * THE ADDRESS IS UNIQUE PER RUN. `WorkspaceInvite::validate()` refuses a second
 * invitation to an address that already has a pending one, so a fixed address
 * would make the second run of this suite fail on a precondition that has
 * nothing to do with what the scenario asserts.
 */
Given('a pending invitation exists for a new address on workspace {string}', async ({ page, baseURL }, slug: string) => {
  await seedInvitation(page, baseURL!, slug, '', '');
});

Given(
  'a pending invitation exists for a new address on workspace {string} as {string} into the team {string}',
  async ({ page, baseURL }, slug: string, role: string, team: string) => {
    await seedInvitation(page, baseURL!, slug, role, team);
  },
);

/**
 * Invites through `WorkspaceInvite::invite()` as the workspace owner. The
 * invitation's grant is authorised like the Members form authorises it, so a
 * Drush process (uid 0) must act as somebody who may change the crew.
 */
async function seedInvitation(page: import('@playwright/test').Page, baseURL: string, slug: string, role: string, team: string): Promise<void> {
  invitedAddress = `bakers-invite-${Date.now()}@example.com`;
  clearLoginFloodFor(invitedAddress);
  await clearMailboxFor(page, baseURL, invitedAddress);
  php(
    `$etm = \\Drupal::entityTypeManager(); $w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));` +
      `$r = "${role}" === "" ? NULL : current($etm->getStorage("og_role")->loadByProperties(["group_type" => "bb_workspace", "label" => "${role}"]));` +
      `$t = "${team}" === "" ? NULL : current($etm->getStorage("bb_team")->loadByProperties(["name" => "${team}", "workspace_id" => $w->id()]));` +
      `$switcher = \\Drupal::service("account_switcher"); $switcher->switchTo($etm->getStorage("user")->load($w->get("owner_user_id")->target_id));` +
      `try { \\Drupal::service("bb_core.workspace_invite")->invite($w, "${invitedAddress}", $r ? $r->id() : NULL, $t ? $t->id() : NULL); } finally { $switcher->switchBack(); }`,
  );
}

/**
 * Reads the invitation mail and follows its one link: the sign-in gate,
 * carrying the join confirmation as `?destination`.
 */
When('I follow the invitation link from the mail', async ({ page, baseURL }) => {
  const messages = await messagesFor(page, baseURL!, invitedAddress);
  expect(messages.length, `no invitation mail reached ${invitedAddress}`).toBeGreaterThan(0);
  const body = await bodyOf(page, baseURL!, String(messages[0].ID));
  const match = body.match(/https?:\/\/\S*\/user\/login\?destination=\S+/);
  expect(match, 'the invitation mail carries no sign-in link').not.toBeNull();
  const link = match![0].replace(/[.,)]+$/, '');
  const target = new URL(link);
  await page.goto(target.pathname + target.search);
});

/**
 * The e-mail door: submit the invited address and type the code that
 * arrives for it, same mechanics `login-flow.ts` already drives for plain
 * sign-in.
 */
When('I sign in with the e-mail code for the invited address', async ({ page, baseURL }) => {
  await clearMailboxFor(page, baseURL!, invitedAddress);
  await submitAddress(page, invitedAddress);
  const code = await loginCodeFor(page, baseURL!, invitedAddress);
  await submitLoginCode(page, code);
});

/**
 * The stub provider. `BbLoginForm::buildForm()` already parked the
 * destination into the session while loading the gate the previous step
 * opened — the same session key
 * `VerifiedEmailAuthenticator::applyPendingDestination()` consumes once the
 * stub hands back its redirect, so the stub route itself carries no
 * `destination` of its own.
 */
When('I sign in through the stub provider as the invited address', async ({ page }) => {
  await page.goto(`/user/login/stub?mail=${encodeURIComponent(invitedAddress)}&verified=1`);
});

Then('the invited account holds no membership on {string}', async ({}, slug: string) => {
  const result = php(
    `$etm = \\Drupal::entityTypeManager(); $w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));` +
      `$a = current($etm->getStorage("user")->loadByProperties(["mail" => "${invitedAddress}"]));` +
      `$m = $a ? \\Drupal::service("og.membership_manager")->getMembership($w, (int) $a->id()) : null;` +
      `print $m ? "yes" : "no";`,
  );
  expect(result, 'joining must stay explicit until Join is used').toBe('no');
});

Then(
  'the invited account holds the workspace role {string} in {string} and is an ordinary member of the team {string}',
  async ({}, role: string, slug: string, team: string) => {
    const result = JSON.parse(php(
      `$etm = \\Drupal::entityTypeManager(); $w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));` +
        `$t = current($etm->getStorage("bb_team")->loadByProperties(["name" => "${team}", "workspace_id" => $w->id()]));` +
        `$a = current($etm->getStorage("user")->loadByProperties(["mail" => "${invitedAddress}"])); $mm = \\Drupal::service("og.membership_manager");` +
        `$wm = $mm->getMembership($w, (int) $a->id()); $tm = $mm->getMembership($t, (int) $a->id());` +
        `print json_encode(["workspace" => $wm && $wm->isActive() ? array_map(fn ($r) => $r->getLabel(), $wm->getRoles()) : NULL, "team" => $tm && $tm->isActive() ? array_map(fn ($r) => $r->getName(), $tm->getRoles()) : NULL]);`,
    )) as { workspace: string[] | null; team: string[] | null };
    // OG's implicit Member role plus exactly the chosen one; no team rank.
    expect(result.workspace, 'no active workspace membership').toEqual(['Member', role]);
    expect(result.team, 'no active team membership').toEqual(['member']);
  },
);

When('I open the projects of workspace {string}', async ({ page }, slug: string) => {
  const response = await page.goto(`/${slug}/projects`);
  expect(response?.status() ?? 0, 'the projects screen did not render').toBeLessThan(400);
});

When('I open the projects of workspace {string} again', async ({ page }, slug: string) => {
  const response = await page.goto(`/${slug}/projects`);
  expect(response?.status() ?? 0, 'the projects screen did not render on the second visit').toBeLessThan(400);
});

Then('the projects list shows {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('main').getByText(name, { exact: true }).first()).toBeVisible();
});

Then('the projects list does not show {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('main').getByText(name, { exact: true })).toHaveCount(0);
});
