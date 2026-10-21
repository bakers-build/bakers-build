// Locators and the save round trip of entity detail pages: the Activities
// feed in the main column and one inspector card per section. Registers no
// steps; support/steps/detail-cards.steps.ts and feature steps import it.
import { expect, type Locator, type Page } from '@playwright/test';

const exact = (text: string): RegExp => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

/**
 * The inspector card whose heading names it: one zone of the single inspector
 * surface (separate sticky surfaces would slide over each other).
 */
export function card(page: Page, heading: string): Locator {
  return page.locator('[data-canvas-region="inspector"] [data-component-id="bb_theme:zone"]').filter({
    has: page.locator('[data-zone-heading]', { hasText: exact(heading) }),
  });
}

/** The card's own save form. */
export function cardForm(page: Page, heading: string): Locator {
  return card(page, heading).locator('form[data-form-save]');
}

/** A labelled control inside the card. */
export function cardField(page: Page, heading: string, label: string): Locator {
  return card(page, heading).getByLabel(label, { exact: true });
}

/** A read-only row of the card, by its label. */
export function cardRow(page: Page, heading: string, label: string): Locator {
  return card(page, heading).locator('[data-list-item]').filter({ hasText: new RegExp(`^\\s*${label}`) });
}

/** The Activities zone and its rows. */
export function activities(page: Page): Locator {
  return page.locator('#entity-detail-activities');
}

export function activityRows(page: Page): Locator {
  return activities(page).locator('[data-component-id="bb_theme:event"]');
}

/**
 * Clicks a submit control of a save form and waits until its answer is in.
 *
 * With JavaScript a save form (`data-hx-post`) posts through htmx and swaps
 * itself: it is inert from the request until the swap. Without JavaScript, or
 * for an ordinary form, the native POST loads a new document.
 */
export async function submitSaveForm(page: Page, form: Locator, control: Locator): Promise<void> {
  const action = await form.getAttribute('action');
  const htmx = await form.getAttribute('data-hx-post') !== null
    && await page.evaluate(() => typeof (window as unknown as { htmx?: unknown }).htmx !== 'undefined');
  if (!htmx) {
    await Promise.all([page.waitForEvent('load'), control.click()]);
    return;
  }
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && !!action && new URL(r.url()).pathname === action);
  await control.click();
  expect((await response).status(), `POST ${action}`).toBeLessThan(500);
  await expect(page.locator('form[data-form-save][inert]')).toHaveCount(0, { timeout: 15000 });
}
