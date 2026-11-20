// The team Members page header's Add member dialog, shared by the add steps.
import { expect, type Locator, type Page } from '@playwright/test';

/** The add dialog's hull. */
export const ADD_DIALOG = 'dialog[data-dialog]:has(form#bb-team-member-add-form)';

/** The page header's Add member trigger. */
export function addMemberTrigger(page: Page): Locator {
  return page.locator('#members-add');
}

/**
 * Opens the dialog through the header trigger, once htmx owns it: the anchor
 * carries a real `href`, so an early click would load the standalone page.
 */
export async function openAddMemberDialog(page: Page): Promise<Locator> {
  const trigger = addMemberTrigger(page);
  await expect(trigger, 'no Add member action in the page header').toBeAttached();
  await expect
    .poll(() => trigger.evaluate((el: Element) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), {
      message: 'htmx never processed the Add member trigger',
      timeout: 20000,
    })
    .toBe(true);
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('_wrapper_format=island_dialog'),
    { timeout: 20000 },
  );
  await trigger.click();
  await answered;
  const dialog = page.locator(ADD_DIALOG);
  await expect(dialog, 'the add dialog did not open').toBeVisible();
  return dialog;
}

/** The dialog's people field: the chip field's combobox. */
export function peopleField(dialog: Locator): Locator {
  return dialog.getByRole('combobox', { name: 'People' });
}

/** Types a name into the people field and takes its listed match as a chip. */
export async function chooseInAddDialog(dialog: Locator, name: string): Promise<void> {
  const field = peopleField(dialog);
  await field.fill(name);
  await dialog.getByRole('option', { name, exact: true }).click();
  await expect(dialog.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}
