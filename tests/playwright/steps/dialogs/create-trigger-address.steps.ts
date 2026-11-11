// Create trigger addresses: no htmx/AJAX transport key in the trigger's
// `href`, `hx-get` or `destination`, and the pages behind them load whole.
// Consumers: features/team/team-create-trigger.
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pageErrors } from '../../support/shell';

const TRANSPORT = /(^|[?&])(ajax_page_state|_wrapper_format|_drupal_ajax)(=|\[)/;
const BOTH = /(^|[?&])(ajax_page_state|_drupal_ajax)(=|\[)/;

/** The `destination` the last checked trigger carries, decoded. */
let destination: string | null = null;

function triggerOf(page: Page, label: string) {
  return page.getByRole('link', { name: label, exact: true });
}

Then('the {string} create trigger carries no transport parameter', async ({ page }, label: string) => {
  const trigger = triggerOf(page, label);
  await expect(trigger, `No "${label}" trigger is on the screen`).toBeAttached();
  const href = (await trigger.getAttribute('href')) ?? '';
  const hxGet = (await trigger.getAttribute('data-hx-get')) ?? (await trigger.getAttribute('hx-get')) ?? '';
  const hrefQuery = new URL(href, page.url()).searchParams;
  destination = hrefQuery.get('destination');
  expect(destination, 'The trigger carries no destination').toBeTruthy();
  expect(decodeURIComponent(new URL(href, page.url()).search.slice(1)), 'href').not.toMatch(TRANSPORT);
  // `hx-get` carries the dialog's own `_wrapper_format`; only the other keys are leaks there.
  expect(decodeURIComponent(new URL(hxGet, page.url()).search.slice(1)), 'hx-get').not.toMatch(BOTH);
  expect(decodeURIComponent(new URL(destination!, page.url()).search.slice(1)), 'destination').not.toMatch(TRANSPORT);
});

When('I cancel the dialog of the {string} create trigger', async ({ page }, label: string) => {
  const trigger = triggerOf(page, label);
  // A click before htmx owns the anchor would navigate to the standalone page.
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), { timeout: 20000 })
    .toBe(true);
  await trigger.click();
  const dialog = page.locator('dialog[data-dialog][open]');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await dialog.locator('[data-dialog-cancel]').click();
  await expect(dialog).toHaveCount(0);
});

Then('the address carries no transport parameter', async ({ page }) => {
  expect(decodeURIComponent(new URL(page.url()).search.slice(1))).not.toMatch(TRANSPORT);
});

When('I visit the destination of the create trigger', async ({ page }) => {
  expect(destination, 'No create trigger was checked first').toBeTruthy();
  const collected: string[] = [];
  pageErrors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  await page.goto(destination!);
  await page.waitForLoadState('networkidle');
});

Then('htmx is loaded without a page error', async ({ page }) => {
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { htmx?: unknown }).htmx), { timeout: 10000 })
    .toBe('object');
  expect(await page.evaluate(() => typeof (window as unknown as { Drupal?: unknown }).Drupal)).toBe('object');
  expect(pageErrors.get(page) ?? []).toEqual([]);
});
