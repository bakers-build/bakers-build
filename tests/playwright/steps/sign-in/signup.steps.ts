import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect, type Page, type Response } from '@playwright/test';
import { provisionState, provisionDelta, type ProvisionState } from '../../support/provision-state';
import {
    bodyOf,
    clearLoginFloodFor,
    clearMailboxFor,
    loginCodeFor,
    loginLinkFor,
    followLoginLink,
    submitLoginCode,
    messagesFor,
    submitAddress,
} from '../../support/login-flow';

/**
 * Steps for BB-430's passwordless login: the form, the mail, the one-time
 * link, and the two things a landed person can do — create a workspace or join
 * an invited one.
 *
 * THE MAIL IS READ OVER MAILPIT'S HTTP API AND ITS LINK IS FOLLOWED. Generating
 * the link with Drush would prove the landing without ever proving a mail was
 * sent, and "exactly one mail arrives" is the half of AC-2 a customer
 * experiences. See `resolve-mailpit-url.ts` for how the base URL is found in
 * both the container and a host run.
 *
 * THE LINK IS TWO HOPS, and the steps below walk both. Core's
 * `[user:one-time-login-url]` points at `user.reset`, which redirects to
 * `user.reset.form` — a confirm screen whose submit POSTs to
 * `user.reset.login`. BB-430 keeps that shape deliberately: hop 1 creates no
 * session, so a mail client or link scanner that prefetches the URL does not
 * burn the customer's link.
 */

let before: ProvisionState;
let lastResponse: Response | null = null;
let lastLink = '';
let lastInviteId = '';
/** The address the current scenario asked for a link with. */
let lastAddress = '';

/**
 * Remove everything a previous run of a provisioning scenario left behind.
 *
 * THE SUITE IS NOT RUN AGAINST A FRESH DATABASE, and these scenarios are the
 * first in this repository that CREATE rather than only read: an account, a
 * workspace, a team, two memberships. Without this the second run finds the
 * account already there (so the "+1 account" delta is 0) and the derived slug
 * already taken (so the name becomes `…-2` and the address assertion fails on a
 * CORRECT product). Cleaning up by ADDRESS keeps the blast radius to the
 * fixture this scenario owns.
 *
 * IT ALSO DELETES INVITATIONS for the address, which is why every scenario that
 * seeds one runs this FIRST — the ordering is not cosmetic and cost one red run
 * to learn.
 */
Given('no account exists for {string}', async ({}, address: string) => {
    const php = [
        '$etm = \\Drupal::entityTypeManager();',
        `foreach ($etm->getStorage("bb_invite")->loadByProperties(["email" => "${address}"]) as $i) { $i->delete(); }`,
        `$a = current($etm->getStorage("user")->loadByProperties(["mail" => "${address}"]));`,
        'if ($a) {',
        '  foreach ($etm->getStorage("bb_workspace")->loadByProperties(["owner_user_id" => $a->id()]) as $w) {',
        '    foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]) as $t) { $t->delete(); }',
        '    $w->delete();',
        '  }',
        '  $ids = $etm->getStorage("og_membership")->getQuery()->accessCheck(FALSE)->condition("uid", $a->id())->execute();',
        '  foreach ($etm->getStorage("og_membership")->loadMultiple($ids) as $m) { $m->delete(); }',
        '  $a->delete();',
        '}',
        'print "clean";',
    ].join(' ');
    expect(Drush.exec(`ev '${php}'`).trim()).toBe('clean');
});

/**
 * Free one derived slug, so a scenario that asserts an EXACT address repeats.
 *
 * `no account exists for` cleans up by address and therefore cannot reach a
 * workspace some OTHER account left holding this slug — and when the slug is
 * taken the deriver correctly returns `…-2`, so the scenario fails on a correct
 * product. A fresh `ddev init` world has none of this; a developer's world
 * accumulates it, and a test that only passes on a fresh database is a test
 * people learn to ignore.
 */
Given('no workspace is slugged {string}', async ({}, slug: string) => {
    const php = [
        '$etm = \\Drupal::entityTypeManager();',
        `foreach ($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]) as $w) {`,
        '  foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]) as $t) { $t->delete(); }',
        '  $ids = $etm->getStorage("og_membership")->getQuery()->accessCheck(FALSE)->condition("entity_type", "bb_workspace")->condition("entity_id", $w->id())->execute();',
        '  foreach ($etm->getStorage("og_membership")->loadMultiple($ids) as $m) { $m->delete(); }',
        '  $w->delete();',
        '}',
        'print "free";',
    ].join(' ');
    expect(Drush.exec(`ev '${php}'`).trim()).toBe('free');
});

When('I request an login link for {string}', async ({ page, baseURL }, address: string) => {
    clearLoginFloodFor(address);
    await clearMailboxFor(page, baseURL!, address);
    before = provisionState(address);
    lastAddress = address;
    await submitAddress(page, address);
});

When('I submit the login address {string}', async ({ page, baseURL }, address: string) => {
    lastAddress = address;
    clearLoginFloodFor(address);
    await clearMailboxFor(page, baseURL!, address);
    before = provisionState(address);
    // BYPASS ONLY THE BROWSER'S OWN VALIDATION, for every address this step
    // submits. `type="email"` plus `required` makes the browser refuse both an
    // empty and a malformed value, so without this the form never POSTs and the
    // step times out waiting for a navigation that cannot happen — while the
    // thing the scenario asserts is DRUPAL's server-side error. The technique
    // is the one the login suite already used for its empty-fields scenario.
    await page.locator('form#bb-login-form').evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
    });
    await submitAddress(page, address);
});

When('I request an login link using only the keyboard for {string}', async ({ page, baseURL }, address: string) => {
    lastAddress = address;
    clearLoginFloodFor(address);
    await clearMailboxFor(page, baseURL!, address);
    before = provisionState(address);
    await page.getByLabel('E-mail address', { exact: true }).focus();
    await page.keyboard.type(address);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Send login link', exact: true })).toBeFocused();
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.keyboard.press('Enter');
    lastResponse = await navigation;
});

When('I follow the login link for {string}', async ({ page, baseURL }, address: string) => {
    lastLink = await loginLinkFor(page, baseURL!, address);
    await followLoginLink(page, lastLink);
});


When('I follow the same login link again', async ({ page }) => {
    await page.context().clearCookies();
    await followLoginLink(page, lastLink);
});

Then('the login form is accessible', async ({ page }) => {
    const field = page.getByLabel('E-mail address', { exact: true });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('type', 'email');
    await expect(field).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByRole('button', { name: 'Send login link', exact: true })).toBeVisible();
    // Exactly one visible input: AC-1 asks for one field, and a second one
    // would mean a workspace selection or a slug crept back in.
    await expect(page.locator('form#bb-login-form input:not([type=hidden])')).toHaveCount(1);
});

// The divider reads as text between the two ways in, in reading order.
Then(
    'the login form separates {string} from {string} with {string}',
    async ({ page }, first: string, second: string, divider: string) => {
        const above = await page.getByRole('button', { name: first, exact: true }).boundingBox();
        const label = page.locator('.gate__content').getByText(divider, { exact: true });
        await expect(label).toBeVisible();
        const middle = await label.boundingBox();
        const below = await page.getByText(second, { exact: true }).boundingBox();
        expect(middle!.y).toBeGreaterThan(above!.y);
        expect(below!.y).toBeGreaterThan(middle!.y);
    },
);

Then('no password field is present', async ({ page }) => {
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

Then('the login form is not built on the dialog grammar', async ({ page }) => {
    // F1.22. AC-11 is a reuse claim and a green build says nothing about which
    // component rendered, so this reads markup: a real `<label for>` bound to
    // the input, and none of `bb_theme:form`'s three regions.
    const id = await page.getByLabel('E-mail address', { exact: true }).getAttribute('id');
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    for (const region of ['form__lead', 'form__properties', 'form__actions']) {
        await expect(page.locator(`.${region}`)).toHaveCount(0);
    }
});

Then('the login confirmation is present', async ({ page }) => {
    // The screen is no longer a notice: it carries the code field that is the
    // other half of the mail (BB-430 r6).
    await expect(page.getByRole('heading', { name: 'Check your mail', exact: true })).toBeVisible();
    await expect(page.getByLabel('Code from the e-mail', { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/user/check-mail');
});

Then('the mail carries a link and a six-digit code', async ({ page, baseURL }) => {
    const link = await loginLinkFor(page, baseURL!, lastAddress);
    // ONE HOP: whichever mechanism the mail carries, following it signs the
    // customer in with no intermediate button. A known address's link
    // addresses `user.reset.login` directly; an unknown address's claim link
    // (BB-558) IS the direct sign-in route and needs no such suffix.
    const isOneHop = link.endsWith('/login') || link.includes('/user/claim/');
    expect(isOneHop, `the link is not one-hop: ${link}`).toBe(true);
    expect(await loginCodeFor(page, baseURL!, lastAddress)).toMatch(/^\d{6}$/);
});

When('I sign in with the code from the mail', async ({ page, baseURL }) => {
    await submitLoginCode(page, await loginCodeFor(page, baseURL!, lastAddress));
});

When('I submit the wrong code', async ({ page }) => {
    await submitLoginCode(page, '000000');
});

Then('the code was refused and still works', async ({ page, baseURL }) => {
    await expect(page.locator('.gate [role="alert"]')).toContainText('wrong or has expired');
    // A TYPO MUST NOT SPEND THE CODE. The customer is holding it; refusing the
    // attempt and consuming the credential would lock them out of a mail they
    // read correctly.
    await submitLoginCode(page, await loginCodeFor(page, baseURL!, lastAddress));
});

Then('the link from the same mail signs in without duplicating the account', async ({ page, baseURL }) => {
    // NOT REFUSED (BB-558 D3, deliberately). The pending row and the code
    // are not cross-consumed: spending the code creates the account, and the
    // still-live nonce then resolves to an address that now HAS an account —
    // `BbSignupClaimController` signs it in rather than duplicating it,
    // which is the same "second sign-in from the same mail" a known address
    // has always been able to do. Forcing the two into one lifetime would
    // shorten the link or lengthen the code.
    const link = await loginLinkFor(page, baseURL!, lastAddress);
    await page.context().clearCookies();
    await followLoginLink(page, link);
    const raw = await page.locator('script[data-drupal-selector="drupal-settings-json"]').textContent().catch(() => null);
    const uid = raw ? Number(JSON.parse(raw)?.user?.uid ?? 0) : 0;
    expect(uid, 'the nonce still resolves to the account the code created').not.toBe(0);
});

Then('exactly one login mail was sent to {string}', async ({ page, baseURL }, address: string) => {
    const messages = await messagesFor(page, baseURL!, address);
    expect(messages).toHaveLength(1);
    const body = await bodyOf(page, baseURL!, String(messages[0].ID));
    // A known address still travels on core's `/user/reset/…` link; an
    // unknown address is mailed `/user/claim/…` instead (BB-558) — which
    // one it carries is exactly what a caller must not be able to tell apart.
    expect(body).toMatch(/\/user\/(?:reset|claim)\//);
    // Saying what the product does. The old bodies told a customer to set a
    // password that does not exist.
    expect(body.toLowerCase()).toMatch(/login link|no password needed|don't need a password/);
    expect(body).not.toContain('set your password');
});

Then('no login mail was sent', async ({ page, baseURL }) => {
    // Scoped to `lastAddress`, not the whole mailbox: another worker's scenario has mail of
    // its own sitting in Mailpit at the same time, and `/api/v1/messages` counts all of it.
    expect(await messagesFor(page, baseURL!, lastAddress)).toHaveLength(0);
});

Then('the login created one account for {string}', async ({}, address: string) => {
    const after = provisionState(address);
    expect(provisionDelta(before, after).user).toBe(1);
    const found = Drush.exec(
        `ev 'print count(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"]));'`,
    ).trim();
    expect(found).toBe('1');
});

Then('the login created no account', async () => {
    expect(provisionDelta(before, provisionState(lastAddress)).user).toBe(0);
});

Then('the login provisioned no workspace', async () => {
    const delta = provisionDelta(before, provisionState(lastAddress));
    expect(delta.bb_workspace).toBe(0);
    expect(delta.bb_team).toBe(0);
});

Then(
    'the login answer is identical for {string} and {string}',
    async ({ page, baseURL }, unknownAddress: string, knownAddress: string) => {
        // D8: a known and an unknown address must be indistinguishable. Compared
        // on status, address and body — the three things a caller can read.
        const seen: Array<{ status: number; path: string; body: string }> = [];
        for (const address of [unknownAddress, knownAddress]) {
            await page.context().clearCookies();
            await page.goto('/user/login');
            await clearMailboxFor(page, baseURL!, address);
            before = provisionState(address);
            await submitAddress(page, address);
            seen.push({
                status: lastResponse?.status() ?? 0,
                path: new URL(page.url()).pathname,
                // The address is never echoed, so the documents are comparable
                // verbatim; a form that printed it back would differ here and
                // that difference would itself be the oracle.
                // BOTH per-render values are stripped: the confirmation
                // screen became a form with BB-430 r6, so it carries a
                // `form_token` as well as a `form_build_id` and neither says
                // anything about which branch ran.
                // EVERY per-render token is normalised, and the list grew
                // with BB-430 r6 because the confirmation screen became a
                // form: a `form_build_id`, a `form_token`, and the randomly
                // NAMED `form-<hash>` hidden field Drupal adds against CSRF.
                // None of the three says anything about which branch ran, and
                // leaving any of them in makes two identical answers compare
                // unequal.
                body: (await page.content())
                    .replace(/form_build_id[^"]*"[^"]*"/g, '')
                    .replace(/form_token[^"]*"[^"]*"/g, '')
                    .replace(/form-[A-Za-z0-9_-]{20,}/g, 'form-TOKEN'),
            });
        }
        expect(seen[0].status).toBe(seen[1].status);
        expect(seen[0].path).toBe(seen[1].path);
        expect(seen[0].body).toBe(seen[1].body);
    },
);

Then('the login error says {string}', async ({ page }, message: string) => {
    await expect(page.locator('.gate [role="alert"]')).toContainText(message);
    const raw = await page.locator('script[data-drupal-selector="drupal-settings-json"]').textContent();
    expect(Number(JSON.parse(raw ?? '{}')?.user?.uid ?? 0)).toBe(0);
});

Then('the login error is associated with its field', async ({ page }) => {
    const field = page.getByLabel('E-mail address', { exact: true });
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const described = await field.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
});

Then('I am not logged in', async ({ page }) => {
    const raw = await page.locator('script[data-drupal-selector="drupal-settings-json"]').textContent();
    expect(Number(JSON.parse(raw ?? '{}')?.user?.uid ?? 0)).toBe(0);
});

Then('the landing carries no password promise', async ({ page }) => {
    // spec r3 R2: core's own `resetPassLogin()` adds "You can set your new
    // password now.", which the D4 subclass removes. Asserted on the landing
    // because only a rendered page shows whether the message survived.
    await expect(page.locator('body')).not.toContainText('set your new password');
    await expect(page.locator('body')).not.toContainText('change your password');
});

Then('the landing is not the account edit form', async ({ page }) => {
    expect(new URL(page.url()).pathname).not.toMatch(/^\/user\/\d+\/edit/);
});

Then('the create action is present', async ({ page }) => {
    await expect(
        page.locator('[data-bakers-home-body]').getByRole('link', { name: 'Create a new workspace', exact: true }),
    ).toHaveCount(1);
});

Then('the create action is present beside the empty state', async ({ page }) => {
    // r2 R3: a SIBLING of `bb_theme:empty-state`, never inside it — that
    // component declares no slots and renders no action.
    const container = page.locator('[data-bakers-home-body]');
    await expect(container.getByRole('link', { name: 'Create a new workspace', exact: true })).toHaveCount(1);
    await expect(container.locator('.empty-state a')).toHaveCount(0);
});

When('I create the workspace {string}', async ({ page }, name: string) => {
    before = provisionState(lastAddress);
    // CLICK THE REAL CREATE LINK ON /home, never page.goto: the gate boosts its
    // links, so reaching the create screen by a click is what exercises the
    // full-document navigation the form action placeholder needs. A page.goto
    // loads it as a full document unconditionally and would hide a boost
    // regression that posts the form to `/home/form_action_p_…` and 404s.
    //
    // After the wizard the empty overview at `/home` carries the create link.
    // Skip the click only when the scenario is already on the create form.
    if (new URL(page.url()).pathname !== '/home/new-workspace') {
        const openNav = page.waitForNavigation({ waitUntil: 'load' });
        await page.getByRole('link', { name: 'Create a new workspace', exact: true }).click();
        await openNav;
    }
    await page.getByLabel('Workspace name', { exact: true }).fill(name);
    await page.getByLabel('Team name', { exact: true }).fill('Core Team');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    // The first project is asked on its own page; Skip leaves it for later.
    await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible();
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    lastResponse = await navigation;
});

/** The team name is required: the browser or the server refuses, either way the form stays. */
When('I try to create the workspace {string} without a team name', async ({ page }, name: string) => {
    if (new URL(page.url()).pathname !== '/home/new-workspace') {
        const openNav = page.waitForNavigation({ waitUntil: 'load' });
        await page.getByRole('link', { name: 'Create a new workspace', exact: true }).click();
        await openNav;
    }
    await page.getByLabel('Workspace name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByLabel('Team name', { exact: true })).toBeVisible();
});

Then('the workspace {string} has a team named {string}', async ({}, slug: string, team: string) => {
    const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); print implode("|", array_map(fn ($t) => $t->label(), \\Drupal::entityTypeManager()->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()])));`;
    expect(Drush.exec(`ev '${php}'`).trim()).toBe(team);
});

Then('no workspace is slugged {string} in the database', async ({}, slug: string) => {
    const php = `print count(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));`;
    expect(Drush.exec(`ev '${php}'`).trim()).toBe('0');
});

Then(
    'the workspace {string} is owned by {string} as lead',
    async ({}, slug: string, address: string) => {
        const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); $a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"])); $m = \\Drupal::service("og.membership_manager")->getMembership($w, (int) $a->id()); print json_encode(["owner" => (string) $w->get("owner_user_id")->target_id === (string) $a->id(), "state" => $m ? $m->getState() : null, "roles" => $m ? array_map(fn ($r) => $r->id(), $m->getRoles()) : []]);`;
        const result = JSON.parse(Drush.exec(`ev '${php}'`).trim()) as {
            owner: boolean;
            state: string | null;
            roles: string[];
        };
        expect(result.owner, 'owner_user_id must be the creator').toBe(true);
        expect(result.state).toBe('active');
        expect(result.roles).toContain('bb_workspace-bb_workspace-lead');
    },
);

Then('the workspace {string} has one team with that account as lead', async ({}, slug: string) => {
    const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); $teams = \\Drupal::entityTypeManager()->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]); $team = current($teams); $m = \\Drupal::service("og.membership_manager")->getMembership($team, (int) $w->get("owner_user_id")->target_id); print json_encode(["teams" => count($teams), "state" => $m ? $m->getState() : null, "roles" => $m ? array_map(fn ($r) => $r->id(), $m->getRoles()) : []]);`;
    const result = JSON.parse(Drush.exec(`ev '${php}'`).trim()) as { teams: number; state: string | null; roles: string[] };
    expect(result.teams).toBe(1);
    expect(result.state).toBe('active');
    expect(result.roles).toContain('bb_team-bb_team-lead');
});

Then('the sign-up provisioned exactly one workspace, one team and two memberships', async () => {
    const delta = provisionDelta(before, provisionState(lastAddress));
    expect(delta.bb_workspace).toBe(1);
    expect(delta.bb_team).toBe(1);
    expect(delta.og_membership).toBe(2);
    console.info(`Create provisioning delta: ${JSON.stringify(delta)}`);
});

Given('a lead has invited {string} to {string}', async ({}, address: string, slug: string) => {
    // Seeded through the entity API rather than a UI, which is the accepted
    // consequence recorded with the approval: no UI in BB-430 creates an
    // invitation, and BB-320 keeps invite management.
    const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); $i = \\Drupal::entityTypeManager()->getStorage("bb_invite")->create(["workspace_id" => $w->id(), "email" => "${address}", "owner_user_id" => (string) $w->get("owner_user_id")->target_id]); $i->save(); print $i->id();`;
    lastInviteId = Drush.exec(`ev '${php}'`).trim();
    expect(lastInviteId).toMatch(/^\d+$/);
});

Then('the overview offers joining {string}', async ({ page }, slug: string) => {
    await expect(page.locator('[data-bakers-home-body="joinable"]')).toHaveCount(1);
    await expect(page.locator('[data-bakers-home-body]')).toContainText(slug);
    const join = lastInviteId
        ? page.locator(`[data-bakers-home-body] a[href="/home/join/${lastInviteId}"]`)
        : page.locator('[data-bakers-home-body] a[href^="/home/join/"]');
    await expect(join).toHaveCount(1);
});

Then('the joinable row carries a workspace, a slug and a join link', async ({ page }) => {
    const row = page.locator(`[data-bakers-home-body] li:has(a[href="/home/join/${lastInviteId}"])`);
    await expect(row.locator('[data-cell="workspace"]')).toHaveCount(1);
    await expect(row.locator('[data-cell="slug"]')).toHaveCount(1);
    const join = row.locator('[data-cell="join"] a');
    await expect(join).toHaveCount(1);
    // An accessible name that names the workspace, so a screen reader hearing
    // several rows can tell which one it is about.
    await expect(join).not.toHaveText('');
});

Then('the account holds no membership on {string}', async ({}, slug: string) => {
    // AC-7: joining is never implicit. Asserted BEFORE the join action is used.
    const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); $i = \\Drupal::entityTypeManager()->getStorage("bb_invite")->load(${lastInviteId || 0}); $a = $i ? current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => $i->getEmail()])) : null; print $a ? (\\Drupal::service("og.membership_manager")->getMembership($w, (int) $a->id()) ? "yes" : "no") : "no-account";`;
    expect(Drush.exec(`ev '${php}'`).trim()).toBe('no');
});

When('I join the invited workspace {string}', async ({ page }, _slug: string) => {
    before = provisionState(lastAddress);
    // CLICK THE REAL JOIN LINK ON /home, never page.goto. The join cell carries
    // full_load, so — unlike every other boosted gate link — clicking it is a
    // full-document navigation to the confirm form, where the form action
    // placeholder is replaced. A page.goto would hide a regression that drops
    // full_load and posts the confirm form to `/home/form_action_p_…` (404).
    const openNav = page.waitForNavigation({ waitUntil: 'load' });
    const join = lastInviteId
        ? page.locator(`a[href="/home/join/${lastInviteId}"]`)
        : page.locator('a[href^="/home/join/"]').first();
    await join.click();
    await openNav;
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    lastResponse = await navigation;
});

Then('the account is an active member of {string}', async ({}, slug: string) => {
    // THE SESSION BELONGS TO THE BROWSER AND NOT TO DRUSH, so the account is
    // identified by the address this scenario signed in with rather than by
    // `currentUser()`, which in a Drush process is always uid 0.
    const php = `$w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); $a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${lastAddress}"])); $m = $a ? \\Drupal::service("og.membership_manager")->getMembership($w, (int) $a->id()) : null; print json_encode(["state" => $m ? $m->getState() : null, "roles" => $m ? array_map(fn ($r) => $r->id(), $m->getRoles()) : []]);`;
    const result = JSON.parse(Drush.exec(`ev '${php}'`).trim()) as { state: string | null; roles: string[] };
    expect(result.state).toBe('active');
    expect(result.roles).toContain('bb_workspace-bb_workspace-member');
});

Then('the invitation for {string} is consumed', async ({}, address: string) => {
    const php = `print count(\\Drupal::entityTypeManager()->getStorage("bb_invite")->loadByProperties(["email" => "${address}"]));`;
    expect(Drush.exec(`ev '${php}'`).trim()).toBe('0');
});

Then('the join provisioned exactly one membership', async () => {
    expect(provisionDelta(before, provisionState(lastAddress)).og_membership).toBe(1);
});

Then('the join provisioned no membership', async () => {
    expect(provisionDelta(before, provisionState(lastAddress)).og_membership).toBe(0);
});

When('I open the join confirm route for the consumed invitation', async ({ page }) => {
    before = provisionState(lastAddress);
    lastResponse = await page.goto(`/home/join/${lastInviteId}`);
});

When('I open the join confirm route for the invitation to {string}', async ({ page }, address: string) => {
    // `lastAddress` is scoping state, not just this route's own bookkeeping: the
    // "provisioned no membership" check that follows reads it too, and the two have to
    // name the same account or "before" and "after" are scoped to different people.
    lastAddress = address;
    before = provisionState(address);
    lastResponse = await page.goto(`/home/join/${lastInviteId}`);
});

Then('the join confirm route answers 403', async () => {
    expect(lastResponse?.status()).toBe(403);
});

/**
 * A consumed invitation states plainly that it is no longer valid, the same
 * page and sentence a revoked or expired one gets: the
 * row is DELETED when the join succeeds (D6/D7 — existence is the pending
 * state), and the route's `{bb_invite}` parameter is raw rather than
 * entity-typed precisely so that a missing row reaches this page instead of
 * 404ing before any access check runs. 403 stays the answer for an invitation
 * that exists and names somebody else.
 */
Then('the join confirm route states the invitation is no longer valid', async () => {
    expect(lastResponse?.status()).toBe(200);
    expect(await lastResponse?.text()).toContain('no longer valid');
});

When('I exercise isolated login throttling', async ({ page, baseURL }) => {
    await page.context().clearCookies();
    await page.goto('/user/login');
    const address = 'flood430@example.com';
    await clearMailboxFor(page, baseURL!, address);
    clearLoginFloodFor(address);
    const limit = Number(Drush.exec('cget user.flood user_limit --format=string').trim());
    before = provisionState(address);
    try {
        for (let attempt = 0; attempt < limit; attempt++) {
            await page.goto('/user/login');
            await submitAddress(page, address);
        }
        const mailedWhileAllowed = (await messagesFor(page, baseURL!, address)).length;
        await page.goto('/user/login');
        await submitAddress(page, address);
        await expect(page.locator('.gate [role="alert"]')).toContainText('Too many attempts');
        // The refusal has to stop the MAIL, not only the message: this form is
        // a mail relay if the limit refuses politely and sends anyway.
        expect((await messagesFor(page, baseURL!, address)).length).toBe(mailedWhileAllowed);
    } finally {
        // Remove this ticket's own flood rows, so the scenario repeats.
        // Core's `user.*` events stay untouched.
        clearLoginFloodFor(address);
    }
});

/** The create form offers a first project; Yes shows its fields and lands on the new project. */
When(
    'I create the workspace {string} with the first project {string} from {string} in the group {string}',
    async ({ page }, name: string, project: string, repository: string, group: string) => {
        before = provisionState(lastAddress);
        if (new URL(page.url()).pathname !== '/home/new-workspace') {
            const openNav = page.waitForNavigation({ waitUntil: 'load' });
            await page.getByRole('link', { name: 'Create a new workspace', exact: true }).click();
            await openNav;
        }
        await page.getByLabel('Workspace name', { exact: true }).fill(name);
        await page.getByLabel('Team name', { exact: true }).fill('Core Team');
        await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
        // The project is the next page, not part of the workspace form.
        await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible();
        await page.getByLabel('Project name', { exact: true }).fill(project);
        await page.getByLabel('Repository URL', { exact: true }).fill(repository);
        await page.getByLabel('Group name', { exact: true }).fill(group);
        const navigation = page.waitForNavigation({ waitUntil: 'load' });
        await page.getByRole('button', { name: 'Create project', exact: true }).click();
        lastResponse = await navigation;
    },
);

Then('I land on the new project {string}', async ({ page }, project: string) => {
    await expect(page).toHaveURL(/\/project\//);
    await expect(page.getByRole('heading', { name: project }).first()).toBeVisible();
});

Then('the project {string} is in the group {string} of the workspace {string}', async ({}, project: string, group: string, slug: string) => {
    const php = `$etm = \\Drupal::entityTypeManager(); $p = current($etm->getStorage("bb_project")->loadByProperties(["name" => "${project}"])); $w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"])); print json_encode($p ? ["group" => $p->get("group_id")->entity->label(), "ws" => (string) $p->get("group_id")->entity->get("workspace_id")->target_id === (string) $w->id(), "teams" => array_map(fn ($t) => $t->label(), $p->get("teams")->referencedEntities())] : null);`;
    const found = JSON.parse(Drush.exec(`ev '${php}'`).trim()) as { group: string; ws: boolean; teams: string[] } | null;
    expect(found, 'The project was not created').not.toBeNull();
    expect(found!.group).toBe(group);
    expect(found!.ws).toBe(true);
    expect(found!.teams).toEqual(['Core Team']);
});

/** So a re-run starts clean: key and name collisions would otherwise refuse the project. */
Given('no project {string} and no group {string} exist', async ({}, project: string, group: string) => {
    const php = `$etm = \\Drupal::entityTypeManager(); foreach ($etm->getStorage("bb_project")->loadByProperties(["name" => "${project}"]) as $p) { $p->delete(); } foreach ($etm->getStorage("bb_group")->loadByProperties(["name" => "${group}"]) as $g) { $g->delete(); }`;
    Drush.exec(`ev '${php}'`);
});
