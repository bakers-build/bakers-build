// Four-step HTMX wizard: identity, About you, skill setup, then prepare your
// first project. Signup and invitation scenarios finish this wizard before
// `I create the workspace {string}` / `I join the invited workspace {string}`.
// `I finish the onboarding wizard` starts on About you, opens setup, opens
// the project page, and Finishes on Home. Nickname is required; remaining
// identity and about-you fields are optional.
import { When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect as baseExpect, type Page } from '@playwright/test';

// HTMX step swaps can exceed Playwright's 5s default under a four-worker run.
// configure() returns a new expect; discarding it leaves the 5s default in place.
const expect = baseExpect.configure({ timeout: 15_000 });

/** Each step is recognised by its own heading in the onboarding chrome. */

const SETUP_COMMAND = '[data-component-id="bb_theme:setup_command"]';

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
    await expect(page.getByRole('heading', { name: 'Get started - set up bakers.build on your machine' })).toBeVisible();
});

/**
 * From About you, open setup, then the project page, and Finish onto Home.
 *
 * Existing signup, invitation and crop scenarios call this from About you.
 */
When('I finish the onboarding wizard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Get started - set up bakers.build on your machine' })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prepare your first project' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
    await expect(page).toHaveURL(/\/home$/);
});

When('I continue from the setup step', async ({ page }) => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prepare your first project' })).toBeVisible();
});

When('I finish the setup guide', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prepare your first project' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page).not.toHaveURL(/\/home\/onboarding\/?$/);
    await expect(page).toHaveURL(/\/home$/);
});

When('I choose finish and create a new workspace', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prepare your first project' })).toBeVisible();
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

Then('the setup installation step is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get started - set up bakers.build on your machine' })).toBeVisible();
});

Then('the project step is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prepare your first project' })).toBeVisible();
});

Then('the project page links to init-project', async ({ page }) => {
    const link = page.getByRole('link', { name: 'Initialize a project' });
    await expect(link).toHaveAttribute('href', /connect-a-project/);
    await expect(link).toHaveAttribute('target', '_blank');
});

Then('only the home finish action is offered', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    await expect(finishAndCreateButton(page)).toHaveCount(0);
});

Then('both finish actions are offered', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
    await expect(finishAndCreateButton(page)).toBeVisible();
});

Then('the command {string} is shown', async ({ page }, command: string) => {
    await expect(page.locator(SETUP_COMMAND).getByText(command, { exact: true })).toBeVisible();
});

When('I choose the {string} agent filter', async ({ page }, name: string) => {
    await page.getByRole('group', { name: 'Agent' }).getByRole('button', { name, exact: true }).click();
});

Then('the setup page links to the documentation and Claude skills', async ({ page }) => {
    await expect(page.locator('[data-component-id="bb_theme:link-group"]')).toBeVisible();
    const docs = page.getByRole('link', { name: 'bakers.build documentation' });
    await expect(docs).toHaveAttribute('href', 'https://bakers.build/docs/get-started/');
    await expect(docs).toHaveAttribute('target', '_blank');
    const install = page.getByRole('link', { name: /Install bakers.build.*new tab/ });
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute('target', '_blank');
    const skills = page.getByRole('link', { name: 'Skill wizard' });
    await expect(skills).toHaveAttribute('href', /skill-wizard-/);
    await expect(skills).toHaveAttribute('target', '_blank');
});

When('clipboard writes fail', async ({ page }) => {
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText() {
                    return Promise.reject(new Error('denied'));
                },
            },
        });
    });
});

When('the clipboard API is unavailable', async ({ page }) => {
    await page.evaluate(() => {
        Reflect.deleteProperty(Navigator.prototype, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: undefined,
        });
    });
});

When('clipboard writes succeed', async ({ page }) => {
    await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(text) {
                    window.__bakersClipboard = text;
                    return Promise.resolve();
                },
                readText() {
                    return Promise.resolve(window.__bakersClipboard || '');
                },
            },
        });`);
});

When('I copy the command {string}', async ({ page }, command: string) => {
    const row = page.locator(SETUP_COMMAND).filter({ hasText: command }).first();
    await row.getByRole('button', { name: /Copy/ }).click();
});

When('I copy the command {string} with the keyboard', async ({ page }, command: string) => {
    const row = page.locator(SETUP_COMMAND).filter({ hasText: command }).first();
    await row.getByRole('button', { name: /Copy/ }).focus();
    await page.keyboard.press('Enter');
});

Then('the copy status for {string} is {string}', async ({ page }, command: string, status: string) => {
    const row = page.locator(SETUP_COMMAND).filter({ hasText: command }).first();
    await expect(row.getByRole('status')).toHaveText(status);
});

Then('the clipboard holds {string}', async ({ page }, command: string) => {
    expect(await page.evaluate('window.__bakersClipboard || ""')).toBe(command);
});

When('I set the viewport to {int} by {int}', async ({ page }, width: number, height: number) => {
    await page.setViewportSize({ width, height });
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
