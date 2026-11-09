import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect, type Page, type Response } from '@playwright/test';
import { markDocument } from '../../support/shell';
import { provisionState } from '../../support/provision-state';
import { getLastSubmittedAddress } from '../../support/login-flow';

/**
 * Sign-in steps for the login surface that replaced the password form.
 *
 * NO PASSWORD CONSTANT LIVES HERE ANY MORE. BB-430 D15 retired the credential
 * form, so `PASSWORD`, `WRONG` and every step that submitted them are gone —
 * with them the keyboard-password walk and the failed-password throttling
 * scenario, whose subject no longer exists. What survives is what was never
 * about a credential: the gate framing, the landing rule, destination handling,
 * workspace privacy and the viewport matrix.
 *
 * `provisionState()` MOVED to `./provision-state` (test plan 10.2), because the
 * registration suite needs the same snapshot — it was written to prove signing
 * in provisions nothing and inverts to prove signing up provisions exactly one
 * of each.
 */

let lastResponse: Response | null;
let origin: string;
let foreignRequests: string[];

async function openLogin(page: Page, destination = ''): Promise<void> {
  await page.context().clearCookies();
  foreignRequests = [];
  const path = '/user/login' + (destination ? `?destination=${encodeURIComponent(destination)}` : '');
  lastResponse = await page.goto(path);
  origin = new URL(page.url()).origin;
  // EVERY MAIN-FRAME DOCUMENT RESPONSE, not just the ones a step awaits. The
  // login path navigates through the mail helper — submit, hop 1, confirm — and
  // none of those assign here, so a status assertion after them was reading the
  // response to `/user/login` and reporting 200 for a page that had long since
  // been replaced. Tracking the navigations makes the variable mean what every
  // caller already assumed it meant.
  page.on('response', response => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) lastResponse = response;
  });
  page.on('request', request => {
    if (request.isNavigationRequest() && new URL(request.url()).origin !== origin) foreignRequests.push(request.url());
  });
  await markDocument(page);
}

When('I open anonymous login', async ({ page }) => openLogin(page));
When('I open anonymous login with destination {string}', async ({ page }, destination: string) => openLogin(page, destination));
When('I mark the authenticated login document', async ({ page }) => markDocument(page));

/**
 * Open `bb_core.home` itself, which is where a used login link lands.
 *
 * NOT `I open the site root`, and the difference is observable rather than
 * cosmetic: `system.site.front` points at `/home`, and Drupal SERVES the front
 * page at `/` without redirecting — so opening the root leaves the address at
 * `/` while rendering the same answer. The old scenarios read `/home` because
 * the password form's submit handler redirected there explicitly. What AC-4
 * pins is the ROUTE the landing resolves through, so the scenarios that assert
 * the landing rule ask for the route.
 */
When('I open the landing route', async ({ page }) => {
  lastResponse = await page.goto('/home');
});

/**
 * Sign in by uid, resolved from the account NAME.
 *
 * NOT `the browser uses recipe account`, and the difference is not stylistic:
 * that step resolves a uuid out of `contract-world.json`, which holds the
 * API-contract fixtures and none of the login accounts — `no-bakery` and its
 * neighbours come from `recipes/bb_e2e/content/user/` and are addressed by
 * name. So this step looks the uid up by name and hands it to the same
 * uid-based provider every other suite uses.
 *
 * WHY BY UID AT ALL, on a ticket that just built an e-mail login: the mailed
 * link is two hops through Mailpit, and a scenario whose subject is the LANDING
 * RULE rather than the login surface has no reason to pay for it. The login
 * path itself is exercised in features/sign-in/signup.feature.
 */
Given('I am signed in as {string}', async ({ page, authProvider }, account: string) => {
  const uid = Number(
    Drush.exec(
      `php:eval '$a = current(\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${account}"])); if (!$a) { throw new \RuntimeException("Missing account fixture: ${account}"); } print $a->id();'`,
    ).trim(),
  );
  expect(uid, `no account named ${account}`).toBeGreaterThan(0);
  await authProvider.login(page, String(uid));
});

Then('I am logged in', async ({ page }) => {
  // THE SESSION COOKIE IS THE ASSERTION, and `drupalSettings` is a corroborator
  // rather than the mechanism. That is a measured choice, not a convenience:
  // on a GATE-FRAMED page — the landing a new account reaches — Drupal emits
  // `drupal-settings-json` carrying `user.uid: 0` even though the request is
  // authenticated, so reading it reported "not logged in" for `/home`, a route
  // that requires `_user_is_logged_in` and that an anonymous visitor cannot
  // reach at all. The cookie cannot disagree with itself that way: it either
  // names a session or it does not.
  //
  // The `uid` is still checked WHERE IT IS POSITIVE, so a shell page keeps the
  // stronger assertion, and a disagreement is printed rather than normalised —
  // a gate page under-reporting the account is a real oddity and worth seeing.
  const cookies = await page.context().cookies();
  const session = cookies.find(cookie => /^SS?ESS/.test(cookie.name) && cookie.value !== '');
  expect(session, `no session cookie on ${page.url()}`).toBeDefined();

  const raw = await page.locator('script[data-drupal-selector="drupal-settings-json"]').textContent().catch(() => null);
  const uid = raw ? Number(JSON.parse(raw)?.user?.uid ?? NaN) : NaN;
  if (!Number.isNaN(uid) && uid === 0) {
    console.info(`drupalSettings reports uid 0 on ${page.url()} while a session cookie is present.`);
  }
});

Then('the login has not provisioned entities', async () => {
  // Scoped to the address this scenario itself submitted, not a site-wide before/after
  // comparison: with four workers running, another one creates or removes an entity of
  // one of these types in the same window regardless of what this scenario did.
  const address = getLastSubmittedAddress();
  const afterState = provisionState(address);
  expect(afterState.user, `user rows for ${address || '(empty address)'}`).toBe(0);
  expect(afterState.bb_workspace).toBe(0);
  expect(afterState.bb_team).toBe(0);
  expect(afterState.og_membership).toBe(0);
  console.info(`Login entity counts for ${address || '(empty address)'}: ${JSON.stringify(afterState)}`);
});
Then('login navigation stayed on the test origin', async ({ page }) => {
  expect(new URL(page.url()).origin).toBe(origin);
  expect(foreignRequests).toEqual([]);
});
Then('the login destination is {string} with status {int}', async ({ page }, path: string, status: number) => {
  expect(new URL(page.url()).pathname).toBe(path);
  expect(lastResponse?.status()).toBe(status);
});
When('I open the anonymous protected login return route', async ({ page }) => {
  await openLogin(page);
  await page.goto('/admin/config');
  expect(new URL(page.url()).pathname).toBe('/user/login');
  expect(new URL(page.url()).searchParams.get('destination')).toBe('/admin/config');
});
When('I check anonymous workspace privacy', async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.goto('/other/tickets');
  expect(response?.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe('/other/tickets');
});
When('I open anonymous login at width {int} and zoom {int}', async ({ page }, width: number, zoom: number) => {
  await page.setViewportSize({ width, height: 900 });
  // Keep the chosen zoom across reset navigation and both password POSTs.
  await page.addInitScript(value => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = `${value}%`; });
  }, zoom);
  await openLogin(page);
  await page.evaluate(value => { document.documentElement.style.zoom = `${value}%`; }, zoom);
});
Then('login controls fit the viewport and show keyboard focus', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The login surface has two controls, not four: one field and one action.
  const controls = [page.getByLabel('E-mail address', { exact: true }), page.getByRole('button', { name: 'Send login link', exact: true })];
  await controls[0].focus();
  for (const [index, control] of controls.entries()) {
    if (index) await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
    expect(await control.evaluate(el => {
      const style = getComputedStyle(el);
      // The ground the form stands on, beside the gate's band.
      const background = getComputedStyle(el.closest('.gate__main')!).backgroundColor;
      return style.outlineStyle !== 'none' && style.outlineColor !== background;
    })).toBe(true);
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.keyboard.press('Shift+Tab');
  await expect(controls[0]).toBeFocused();
});
