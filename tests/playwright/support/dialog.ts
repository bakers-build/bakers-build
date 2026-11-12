import { expect, type Locator, type Page } from '@playwright/test';

/** The open island dialog. */
export function openDialog(page: Page) {
  return page.locator('dialog[data-dialog][open]');
}

/** Waits until htmx owns a dialog trigger, then opens it. */
export async function openInDialog(page: Page, trigger: Locator): Promise<void> {
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), { timeout: 20000 })
    .toBe(true);
  const answered = page.waitForResponse((response) => response.url().includes('_wrapper_format=island_dialog'));
  await trigger.click();
  await answered;
  await expect(openDialog(page)).toBeVisible();
}

