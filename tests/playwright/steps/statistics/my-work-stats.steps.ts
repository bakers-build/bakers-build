// My work › Stats: the account's own tables and the exact value behind an
// abbreviated number.
//
// Login, My work tabs, the period range, the filter popover and the address
// are NOT re-implemented here — `steps/home/my-work-tabs.steps.ts`,
// `steps/statistics/insights.steps.ts` and `support/steps/*` own them.
import { Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The block a statistics table sits in, found by its heading. */
const tableBlock = (page: Page, table: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: table, exact: true }) }).last();

/** The body rows of a statistics table. */
const bodyRows = (page: Page, table: string) => tableBlock(page, table).locator('tbody tr');

/** The count at the start of an exact-value tooltip, "1,840,000 tokens — …". */
const exactCount = (text: string): number => Number(text.split(' ')[0].replace(/[^0-9]/g, ''));

Then(
  'the table {string} lists the highest {string} first',
  async ({ page }, table: string, column: string) => {
    const headers = (await tableBlock(page, table).getByRole('columnheader').allInnerTexts()).map((text) => text.trim());
    const index = headers.findIndex((header) => header.startsWith(column));
    expect(index, `The table "${table}" has no column "${column}"`).toBeGreaterThanOrEqual(0);
    // Row header and cells are siblings, so the column is the nth child.
    const tips = await bodyRows(page, table).locator(`> :nth-child(${index + 1}) [role="tooltip"]`).allTextContents();
    expect(tips.length, `The table "${table}" has no rows`).toBeGreaterThan(0);
    const counts = tips.map(exactCount);
    expect(counts[0]).toBe(Math.max(...counts));
  },
);

Then(
  'every row of the table {string} names {string}',
  async ({ page }, table: string, name: string) => {
    const names = (await bodyRows(page, table).locator('> :first-child').allInnerTexts()).map((text) => text.trim());
    expect(names.length, `The table "${table}" has no rows`).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set([name]));
  },
);

Then('hovering the tile {string} reveals its exact token count', async ({ page }, label: string) => {
  const tile = page.locator('.stat-tile__label', { hasText: label }).locator('xpath=ancestor::*[.//*[contains(@class, "stat-tile__value")]][1]');
  const value = tile.locator('.stat-tile__value').first();
  await value.hover();
  const tip = page.locator(`#${await value.getAttribute('aria-describedby')}`);
  await expect(tip).toHaveCSS('opacity', '1');
  await expect(tip).toHaveText(/^[\d,]+ tokens/);
});
