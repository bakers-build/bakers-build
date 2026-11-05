import { Drush } from './drush';
import { expect, type Page } from '@playwright/test';
import { resolveMailpitURLFrom } from '../resolve-mailpit-url';

/**
 * The passwordless login mechanics, shared by the suites that need them.
 *
 * EXTRACTED FOR A SECOND CALLER, the same way `provision-state.ts` was: the
 * auth-contract suite has to assert that a `?destination` survives login, and
 * with the credential form retired that assertion now runs through the whole
 * mail round-trip. Two copies of a Mailpit fetch would drift.
 */

/** Mailpit's API base, resolved the way the site's own base URL is. */
export function mailpitBase(baseURL: string): string {
    return resolveMailpitURLFrom(process.env, baseURL);
}

/** Every message Mailpit currently holds for one address. */
export async function messagesFor(page: Page, baseURL: string, address: string): Promise<Array<Record<string, unknown>>> {
    // A deliberately empty address (the "empty submission" scenario) never reaches Mailpit:
    // an empty `query` is a request Mailpit itself refuses, not a search for zero messages.
    if (!address) return [];
    const url = `${mailpitBase(baseURL)}/api/v1/search?query=${encodeURIComponent(address)}`;
    const response = await page.request.get(url);
    expect(response.ok(), `Mailpit did not answer at ${url}`).toBe(true);
    const body = (await response.json()) as { messages?: Array<Record<string, unknown>> };
    return body.messages ?? [];
}

/** The plain-text body of one Mailpit message. */
export async function bodyOf(page: Page, baseURL: string, id: string): Promise<string> {
    const response = await page.request.get(`${mailpitBase(baseURL)}/api/v1/message/${id}`);
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { Text?: string; HTML?: string };
    return body.Text ?? body.HTML ?? '';
}

/**
 * Discard the messages Mailpit holds FOR ONE ADDRESS, so "exactly one mail arrived" is a
 * statement about this scenario. Deleting the whole mailbox took the mail of whatever
 * scenario was running on another worker at the time.
 */
export async function clearMailboxFor(page: Page, baseURL: string, address: string): Promise<void> {
    const ids = (await messagesFor(page, baseURL, address)).map(message => String(message.ID));
    if (!ids.length) return;
    const response = await page.request.delete(`${mailpitBase(baseURL)}/api/v1/messages`, { data: { IDs: ids } });
    expect(response.ok(), 'Mailpit refused the scoped delete').toBe(true);
}

/**
 * Clear the flood rows of ONE ADDRESS, so a scenario that spends the per-address budget
 * repeats. The per-IP event is not cleared and does not need to be: the e2e world lifts
 * `user.flood.ip_limit` (recipes/bb_e2e), because one container IP is a budget every
 * worker spends from. Core's own `user.*` rows stay untouched either way.
 */
export function clearLoginFloodFor(address: string): void {
    // Core's flood table is created lazily on first register(); a fresh
    // recipe-test world has nothing to delete until a login event lands.
    const php = `if (\\Drupal::database()->schema()->tableExists("flood")) { \\Drupal::database()->delete("flood")->condition("event", "bb_login.login_mail")->condition("identifier", "${address.toLowerCase()}")->execute(); } print "cleared";`;
    Drush.exec(`ev '${php}'`);
}

let lastSubmittedAddress = '';

/** The address the most recent `submitAddress` call typed into the form, empty submission included. */
export function getLastSubmittedAddress(): string {
    return lastSubmittedAddress;
}

/**
 * Fill the login form with one address and submit it as a full document POST.
 */
export async function submitAddress(page: Page, address: string): Promise<void> {
    lastSubmittedAddress = address;
    // Bypass ONLY the browser's own validation. `type="email"` plus `required`
    // makes the browser refuse an empty or malformed value, so without this the
    // form never POSTs and a caller waits for a navigation that cannot happen —
    // while what the scenarios assert is DRUPAL's server-side answer.
    await page.locator('form#bb-login-form').evaluate((form: HTMLFormElement) => {
        form.noValidate = true;
    });
    await page.getByLabel('E-mail address', { exact: true }).fill(address);
    const posted = page.waitForRequest(
        request => request.method() === 'POST' && /\/user\/(login|register)$/.test(new URL(request.url()).pathname),
    );
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Send login link', exact: true }).click();
    await navigation;
    const request = await posted;
    // A full document POST, never a boosted fragment: the session has to
    // replace the anonymous document rather than be swapped into it.
    expect(request.resourceType()).toBe('document');
    expect(request.headers()['hx-request']).toBeUndefined();
}

/**
 * The login link out of the mail that just arrived for an address.
 *
 * TWO MECHANISMS, ONE REGEX (BB-558). A known address still travels on
 * core's `/user/reset/…` one-time link; an unknown address is now mailed
 * `/user/claim/…` instead, because the deferred account has no uid yet to
 * derive core's token from. Which one a mail carries is exactly what the
 * customer must not be able to tell apart, so the step that reads it stays
 * one function rather than branching on membership.
 */
export async function loginLinkFor(page: Page, baseURL: string, address: string): Promise<string> {
    const messages = await messagesFor(page, baseURL, address);
    expect(messages.length, `no mail reached ${address}`).toBeGreaterThan(0);
    const body = await bodyOf(page, baseURL, String(messages[0].ID));
    const match = body.match(/https?:\/\/\S*\/user\/(?:reset|claim)\/\S+/);
    expect(match, 'the mail carries no login link').not.toBeNull();
    return match![0].replace(/[.,)]+$/, '');
}

/**
 * Follow the mailed link, which signs the customer in on the first click.
 *
 * ONE HOP SINCE BB-430 r6: the mail addresses `user.reset.login` directly, so
 * there is no confirmation button to press. The screen that used to sit here
 * existed only to survive link prefetching, and the CODE in the same mail
 * covers that case better — a scanner cannot type one.
 */
export async function followLoginLink(page: Page, link: string): Promise<void> {
    const target = new URL(link);
    await page.goto(target.pathname + target.search);
}

/**
 * The six-digit code out of the mail that just arrived for an address.
 *
 * Taken as the first standalone run of six digits, so a mail client's wrapping
 * cannot hide it — and read with the CRLF stripped, which cost a debugging
 * round when a `$`-anchored match silently found nothing.
 */
export async function loginCodeFor(page: Page, baseURL: string, address: string): Promise<string> {
    const messages = await messagesFor(page, baseURL, address);
    expect(messages.length, `no mail reached ${address}`).toBeGreaterThan(0);
    const body = (await bodyOf(page, baseURL, String(messages[0].ID))).replace(/\r/g, '');
    const match = body.match(/(?:^|\s)(\d{6})(?:\s|$)/);
    expect(match, 'the mail carries no six-digit code').not.toBeNull();
    return match![1];
}

/**
 * Type a code on the confirmation screen and submit it.
 */
export async function submitLoginCode(page: Page, code: string): Promise<void> {
    await page.getByLabel('Code from the e-mail', { exact: true }).fill(code);
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await navigation;
}

/**
 * Submit an address and ride the mailed link all the way to the landing.
 */
export async function requestAndFollowLoginLink(page: Page, baseURL: string, address: string): Promise<void> {
    clearLoginFloodFor(address);
    await clearMailboxFor(page, baseURL, address);
    await submitAddress(page, address);
    await followLoginLink(page, await loginLinkFor(page, baseURL, address));
}
