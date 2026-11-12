// Locators of the Project Board: its cards and its active filter chips.
import { expect, type Locator, type Page } from '@playwright/test';

/** A card is a ticket article; its title is the article's paragraph. */
const CARD = 'article[data-state]';

/** The titles of the cards inside a Board, a column or a section of either. */
export async function cardTitles(scope: Page | Locator): Promise<string[]> {
  return (await scope.locator(`${CARD} > p`).allInnerTexts()).map((title) => title.trim()).sort();
}

/** Expects exactly these cards, in any order. */
export async function expectCards(scope: Page | Locator, titles: string): Promise<void> {
  await expect.poll(() => cardTitles(scope), { timeout: 10000 }).toEqual(titles.split(', ').sort());
}

/** The card of a ticket title. */
export function card(page: Page, title: string): Locator {
  return page.locator(CARD).filter({ has: page.getByText(title, { exact: true }) });
}

/** Each active filter chip as it reads: field, operator, values and count. */
export function activeFilters(page: Page): Promise<string[]> {
  return page.locator('[data-facet]').evaluateAll((chips) => chips.map(
    (chip) => Array.from(chip.querySelectorAll('[data-part]'), (part) => part.textContent?.trim()).join(' '),
  ));
}
