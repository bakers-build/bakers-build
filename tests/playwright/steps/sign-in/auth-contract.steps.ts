import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import { test, expect } from '../../bdd.fixtures';
import { requestAndFollowLoginLink } from '../../support/login-flow';

const { Given, When, Then } = createBdd(test);

Given('the contract browser is anonymous', async ({ page }) => {
    await page.context().clearCookies();
});
Given('Stark presents the authentication forms', async ({ page, baseURL }) => {
    // Per request/browser-context instead of per site (bb_browser_test's
    // CookieThemeNegotiator): one context can assert the neutral theme while other
    // parallel workers keep the product theme.
    await page.context().addCookies([{ name: 'bb_browser_test_theme', value: 'stark', url: baseURL! }]);
});
Then('the authentication module adds no theme navigation links', async ({ page }) => {
    // The form id changed with BB-430: `/user/login` renders the e-mail login form
    // form, so `user-login-form` is no longer built anywhere. What the check is
    // about is unchanged — the module contributes no register or password link
    // of its own — and the login form deliberately carries neither.
    await expect(page.locator('form#bb-login-form')).toBeVisible();
    await expect(page.locator('a[href*="/user/register"]')).toHaveCount(0);
    await expect(page.locator('a[href*="/user/password"]')).toHaveCount(0);
});
Then('the contract browser stays on {string}', async ({ page }, path: string) => {
    expect(new URL(page.url()).pathname).toBe(path);
});
When('a recipe account signs in with its own profile as destination', async ({ page, apiClient, baseURL }) => {
    // BB-430 replaced the credential form, so the destination now has to
    // survive a MAIL ROUND-TRIP rather than one request. It does, in two
    // independent ways, and this scenario exercises both at once: the login
    // form parks it in the session, and the mailed link carries it as a query
    // that hop 1 lifts into that same session. Whichever arrives, hop 2 hands
    // it back to core's `RedirectResponseSubscriber`, which applies and
    // validates it exactly as it did for the password form.
    const uuid = apiClient.fixtureId('user.stranger');
    const account = JSON.parse(
        Drush.exec(
            `php:eval '$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${uuid}"); print json_encode(["uid" => $a->id(), "mail" => $a->getEmail()]);'`,
        ).trim(),
    ) as { uid: string; mail: string };
    await page.context().clearCookies();
    await page.goto(`/user/login?destination=${encodeURIComponent(`/user/${account.uid}`)}`);
    await requestAndFollowLoginLink(page, baseURL!, account.mail);
    await expect(page).toHaveURL(url => url.pathname === `/user/${account.uid}`);
});
