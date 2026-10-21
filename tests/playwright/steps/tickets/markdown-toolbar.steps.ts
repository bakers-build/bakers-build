// The Markdown toolbar over a bb_rich body: a field is addressed by its
// label, inside the open dialog when there is one, and its toolbar by the
// textarea id the toolbar's `for` names. Step texts unescape `\n` so a
// scenario can state multi-line Markdown on one line (`\r` for a native
// form post, which sends textarea line breaks as CRLF).
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';

const { When, Then, After } = createBdd(test);

// The saved-value scenario creates a real ticket; left behind it would fill
// cwiedemann's lists that ticket-list counts.
const CREATED_TITLE = 'Markdown stored as typed';

After({ tags: '@feature:markdown-authoring' }, async () => {
  php([
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
    `$s->delete($s->loadByProperties(["title" => "${CREATED_TITLE}"]));`,
  ].join(' '));
});

const BUTTONS = ['Heading', 'Bold', 'Italic', 'Code', 'Link', 'Bullet list', 'Numbered list'];

const unescape = (text: string): string => text.replace(/\\r/g, '\r').replace(/\\n/g, '\n');

async function field(page: Page, label: string): Promise<Locator> {
  const dialog = page.locator('dialog[open]');
  const scope = (await dialog.count()) > 0 ? dialog : page.locator('body');
  const textarea = scope.getByRole('textbox', { name: label, exact: true });
  await expect(textarea).toBeVisible();
  return textarea;
}

async function toolbarOf(page: Page, label: string): Promise<Locator> {
  const id = await (await field(page, label)).getAttribute('id');
  return page.locator(`markdown-toolbar[for="${id}"]`);
}

Then('the {string} field has a Markdown toolbar', async ({ page }, label: string) => {
  const toolbar = await toolbarOf(page, label);
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute('role', 'toolbar');
  await expect(toolbar).toHaveAccessibleName('Text formatting');
  const buttons = toolbar.getByRole('button');
  await expect(buttons).toHaveCount(BUTTONS.length);
  for (const [index, name] of BUTTONS.entries()) {
    await expect(buttons.nth(index)).toHaveAccessibleName(name);
  }
});

Then('the {string} field has no Markdown toolbar', async ({ page }, label: string) => {
  await expect(await toolbarOf(page, label)).toBeHidden();
});

When('I write {string} in the {string} field', async ({ page }, text: string, label: string) => {
  await (await field(page, label)).fill(unescape(text));
});

When('I select {string} in the {string} field', async ({ page }, text: string, label: string) => {
  const selected = await (await field(page, label)).evaluate((textarea: HTMLTextAreaElement, part: string) => {
    const start = textarea.value.indexOf(part);
    textarea.focus();
    textarea.setSelectionRange(start, start + part.length);
    return start;
  }, unescape(text));
  expect(selected, `"${text}" is not in the ${label} field`).toBeGreaterThanOrEqual(0);
});

When('I select all of the {string} field', async ({ page }, label: string) => {
  await (await field(page, label)).evaluate((textarea: HTMLTextAreaElement) => {
    textarea.focus();
    textarea.select();
  });
});

When('I press the Markdown button {string} of the {string} field', async ({ page }, button: string, label: string) => {
  await (await toolbarOf(page, label)).getByRole('button', { name: button, exact: true }).click();
});

Then('the {string} field reads {string}', async ({ page }, label: string, text: string) => {
  await expect(await field(page, label)).toHaveValue(unescape(text));
});

When('I reach the Markdown toolbar of the {string} field with Shift+Tab', async ({ page }, label: string) => {
  await (await field(page, label)).focus();
  await page.keyboard.press('Shift+Tab');
  const toolbar = await toolbarOf(page, label);
  await expect(toolbar.locator(':focus')).toHaveCount(1);
});

When('I press the key {string}', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

Then('the focused Markdown button is {string}', async ({ page }, name: string) => {
  await expect(page.locator('markdown-toolbar :focus')).toHaveAccessibleName(name);
});

Then('the newest ticket titled {string} stores the description {string} in {string}', async ({}, title: string, text: string, format: string) => {
  const stored = php([
    '$ids = \\Drupal::entityQuery("bb_ticket")->accessCheck(FALSE)',
    `->condition("title", "${safe(title)}")->sort("id", "DESC")->range(0, 1)->execute();`,
    '$t = $ids ? \\Drupal::entityTypeManager()->getStorage("bb_ticket")->load(reset($ids)) : NULL;',
    'print $t ? json_encode(["value" => $t->get("description")->value, "format" => $t->get("description")->format]) : "";',
  ].join(' ')).split('\n').pop() ?? '';
  expect(stored, `No ticket titled "${title}" was stored`).not.toBe('');
  expect(JSON.parse(stored)).toEqual({ value: unescape(text), format });
});
