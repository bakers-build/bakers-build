// Three-step HTMX wizard: identity, About you, then documentation links per
// audience. Signup and invitation scenarios finish this wizard before
// `I create the workspace {string}` / `I join the invited workspace {string}`.
// `I finish the onboarding wizard` starts on About you, opens setup and
// Finishes on Home. Nickname is required; remaining
// identity and about-you fields are optional.
import { When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect as baseExpect, type Page } from '@playwright/test';

// HTMX step swaps can exceed Playwright's 5s default under a four-worker run.
// configure() returns a new expect; discarding it leaves the 5s default in place.
const expect = baseExpect.configure({ timeout: 15_000 });

/** Each step is recognised by its own heading in the onboarding chrome. */

/** The create-workspace finish control; `&` in the label must not be required as an entity. */
function finishAndCreateButton(page: Page) {
    return page.getByRole('button', { name: /Finish .* create a new workspace/ });
}
Then('the identity step is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
});

Then('the about-you step is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible();
});

/**
 * Presses Skip, which advances WITHOUT writing.
 *
 * Not `Next`: that one validates the nickname and saves. The difference is
 * the whole of AC-3's skip half, so the two steps must not share a control.
 */
When('I skip the identity step', async ({ page }) => {
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible();
});

When('I continue from the identity step', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible();
});

When('I go back from the about-you step', async ({ page }) => {
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
});

When('I continue from the about-you step', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get started with bakers.build' })).toBeVisible();
});

/**
 * From About you, open setup and Finish onto Home.
 *
 * Existing signup, invitation and crop scenarios call this from About you.
 */
When('I finish the onboarding wizard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get started with bakers.build' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
    await expect(page).toHaveURL(/\/home$/);
});

When('I finish the setup guide', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get started with bakers.build' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
    await expect(page).toHaveURL(/\/home$/);
});

When('I choose finish and create a new workspace', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get started with bakers.build' })).toBeVisible();
    await finishAndCreateButton(page).click();
    // Finish & create is either an HX-Redirect to workspace create or, when a
    // late invitation appears, an HX-Location onto Home. Both leave this path
    // after the XHR; `the address is` reads the pathname with no wait.
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
});

When('I set up later', async ({ page }) => {
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
    await expect(page).toHaveURL(/\/home$/);
});

When('I open the setup guide', async ({ page }) => {
    const openNav = page.waitForNavigation({ waitUntil: 'load' });
    await page.getByRole('link', { name: 'Setup guide', exact: true }).click();
    await openNav;
    await expect(page).toHaveURL(/\/home\/onboarding/);
});

Then('the setup guide step is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get started with bakers.build' })).toBeVisible();
});

Then('only the home finish action is offered', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    await expect(finishAndCreateButton(page)).toHaveCount(0);
});

Then('both finish actions are offered', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    await expect(finishAndCreateButton(page)).toBeVisible();
});

Then('the wizard progress reads {string}', async ({ page }, text: string) => {
    await expect(page.locator('[aria-current="step"]')).toHaveText(text);
});

Then('the audience {string} links {string} to {string} in a new tab', async ({ page }, audience: string, title: string, url: string) => {
    const group = page.locator('[data-component-id="bb_theme:link-group"]').filter({ hasText: audience });
    const link = group.getByRole('link', { name: new RegExp(`^${title}`) });
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
});

Then('the setup guide shows no commands and no Next', async ({ page }) => {
    await expect(page.locator('[data-component-id="bb_theme:setup_command"]')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Agent' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
});

Then('the account {string} has not completed onboarding', async ({}, address: string) => {
    expect(accountOnboardingComplete(address)).toBe(false);
});

Then('the account {string} has completed onboarding', async ({}, address: string) => {
    expect(accountOnboardingComplete(address)).toBe(true);
});

Then('the home overview empty state is present', async ({ page }) => {
    await expect(page.locator('[data-bakers-home-body="empty"]')).toBeVisible();
});

Then('the invite screen is not present', async ({ page }) => {
    await expect(page).not.toHaveTitle(/Hol dein Team dazu/);
});

When('I fill in the identity step with name {string} and nickname {string}', async ({ page }, fullName: string, nickname: string) => {
    await page.getByLabel('Full name', { exact: true }).fill(fullName);
    await page.getByLabel('Nickname (username)', { exact: true }).fill(nickname);
});

/**
 * Chooses a file for the picture field.
 *
 * Nothing is uploaded yet: the file goes with the next Next POST. An image
 * opens the crop dialog at once; its centred default is applied unchanged.
 */
When('I attach the picture {string}', async ({ page }, fixture: string) => {
    await page.getByLabel('Profile picture', { exact: true }).setInputFiles(`fixtures/${fixture}`);
    const crop = page.getByRole('dialog', { name: 'Crop image' });
    if (fixture !== 'not-an-image.png') {
        await crop.getByRole('button', { name: 'Apply' }).click();
    }
    await expect(crop).toBeHidden();
});

/** Presses Next where the step is expected to come back with an error. */
When('I press Next on the identity step', async ({ page }) => {
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/home/onboarding');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await response;
});

Then('the identity step shows the error {string}', async ({ page }, message: string) => {
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(message);
});

/** The file travels with Next; the widget offers no separate Upload. */
Then('the picture control has no upload button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
});

const wizardPosts = new WeakMap<object, { hx: string | null }[]>();

When("I record the wizard's requests", async ({ page }) => {
    const posts: { hx: string | null }[] = [];
    wizardPosts.set(page, posts);
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/home/onboarding') {
            posts.push({ hx: request.headers()['hx-request'] ?? null });
        }
    });
});

Then('every wizard request was sent by HTMX', async ({ page }) => {
    const posts = wizardPosts.get(page) ?? [];
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((post) => post.hx === 'true')).toBe(true);
});

Then('the account {string} has the full name {string}', async ({}, address: string, expected: string) => {
    expect(accountField(address, 'field_full_name')).toBe(expected);
});

Then('the account {string} has no full name', async ({}, address: string) => {
    expect(accountField(address, 'field_full_name')).toBe('');
});

Then('the account {string} is named {string}', async ({}, address: string, expected: string) => {
    expect(accountName(address)).toBe(expected);
});

Then('the account {string} is not named {string}', async ({}, address: string, rejected: string) => {
    expect(accountName(address)).not.toBe(rejected);
});

/** Whether the account with the given address has a stored picture. */
function hasPicture(address: string): boolean {
    const php = `$a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"]));` +
        'print $a && !$a->get("user_picture")->isEmpty() ? "yes" : "no";';
    return Drush.exec(`ev '${php}'`).trim() === 'yes';
}

Then('the account {string} has a saved picture', async ({}, address: string) => {
    expect(hasPicture(address)).toBe(true);
});

Then('the account {string} has no saved picture', async ({}, address: string) => {
    expect(hasPicture(address)).toBe(false);
});

/** Reads one stored field off the account with the given address. */
function accountField(address: string, field: string): string {
    const php = `$a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"]));` +
        `print $a ? (string) $a->get("${field}")->value : "";`;
    return Drush.exec(`ev '${php}'`).trim();
}

/** Reads the stored username off the account with the given address. */
function accountName(address: string): string {
    const php = `$a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"]));` +
        'print $a ? $a->getAccountName() : "";';
    return Drush.exec(`ev '${php}'`).trim();
}

/** Whether the account has stored onboarding completion. */
function accountOnboardingComplete(address: string): boolean {
    const php = `$a = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["mail" => "${address}"]));` +
        'print $a && (int) $a->get("field_onboarding_completed")->value ? "yes" : "no";';
    return Drush.exec(`ev '${php}'`).trim() === 'yes';
}
