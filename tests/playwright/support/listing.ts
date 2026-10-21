// State and helpers of the faceted list screens (tickets, runs, projects).
// One Playwright worker runs its feature files one after another in one Node
// process, so this state is per worker and every Background resets it.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The page later steps read, when it is not the fixture's own.
 *
 * Two scenarios need a page the `page` fixture cannot be: the no-JavaScript one
 * needs a context built with `javaScriptEnabled: false`, and the share half of
 * AC 5 needs a second tab in the SAME context — a second context would lose the
 * session and prove nothing about the address. Both are held here and cleared by
 * the Background step, which every scenario runs first, so nothing leaks from
 * one scenario into the next.
 *
 * `uid` is the account the `Given` step signed in as. The `my_work` scenario
 * has to state WHOSE work the screen is showing, and the account is resolved from the seed rather than hardcoded — so the expected set
 * of tickets has to be resolved from the same uid, not from a name typed into a
 * scenario.
 */
export const listing: { page: Page | null; uid: string | null; slug: string | null } = {
  page: null,
  uid: null,
  slug: null,
};

export function active(page: Page): Page {
  return listing.page ?? page;
}

/**
 * Clears the page override for a suite whose own Background does not.
 *
 * `listing.page` is shared listing state, set by the no-JavaScript
 * scenario and by "I open the current address in a fresh tab" — both of
 * which this file's closed-position steps (BB-490) are reused from. All
 * of that state lives for the run of one Playwright WORKER PROCESS, which
 * runs every `.feature` file `fullyParallel: false` assigns to it, one after
 * another, in one Node process — so a value `run-list.feature` never sets can
 * still be READ there if a `ticket-list` scenario set it earlier on the same
 * worker and never got the chance to reset it. `run-list.steps.ts`'s own "the
 * run index is up to date" calls this so the runs tab never inherits a stale,
 * possibly-closed page from a ticket-list scenario that ran before it on that
 * worker.
 */
export function resetOverridePage(): void {
  listing.page = null;
}

/** Whatever a Gherkin string may not smuggle into a shell or into PHP. */
export function safe(value: string): string {
  return value.replace(/["'\\$]/g, '');
}

/** The facet's accessible name keeps its field name when its value changes. */
export function facetTrigger(target: Page, facet: string) {
  const escaped = facet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return target.getByRole('combobox', { name: new RegExp(`^Change ${escaped}\\.`, 'i') }).first();
}

/**
 * Opens the named facet if needed and returns the option row whose label
 * matches. Shared by the keyboard pick, the pointer pick, and the
 * checked/unchecked assertions so all three locate a row the same way.
 */
export async function facetRow(page: Page, facet: string, label: string) {
  const target = active(page);
  const trigger = facetTrigger(target, facet);
  await expect(trigger, `No facet is called "${facet}"`).toBeAttached();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  const panelId = await trigger.getAttribute('aria-controls');
  const row = target
    .locator(`#${panelId} li[data-value]`)
    .filter({ has: target.locator('.option-list__label', { hasText: label }) })
    .first();
  await expect(row, `The "${facet}" facet offers no "${label}"`).toBeAttached();
  return row;
}

/**
 * The control's own container, found by the accessible name its `label` prop
 * gives the group — never by a class, which is styling.
 */
export function closedControl(target: Page) {
  return target.locator('[role="group"][aria-label="Closed rows"]');
}

/**
 * The listing toolbar: the search field and the "Sort by" select above the
 * rows. Both sit outside the exposed form and join it through their `form`
 * attribute, so they submit together with the facets.
 */
export const SEARCH_TOOLBAR = '[role="search"][aria-label="Search and sort"]';

/**
 * Asserts the toolbar holds search then sort, both bound to the exposed form
 * by `form=` rather than nested in it, and that it precedes `below`.
 */
export async function expectToolbarAbove(target: Page, scope: string, below: string): Promise<void> {
  const toolbar = target.locator(`${scope} ${SEARCH_TOOLBAR}`);
  await expect(toolbar, 'No "Search and sort" toolbar on this listing').toHaveCount(1);
  // The accessible name, not the input type: the theme's form_input renders
  // `type="text"` even for Views' `search` element.
  await expect(toolbar.locator('input[name="title"]')).toBeVisible();
  await expect(toolbar.locator('input[name="title"]')).toHaveAccessibleName('Search');
  await expect(toolbar.getByRole('combobox', { name: 'Sort by' })).toBeVisible();
  const facts = await toolbar.evaluate((bar, belowSelector) => {
    const search = bar.querySelector('input[name="title"]');
    const sort = bar.querySelector('select[name="sort_bef_combine"]');
    const formId = search?.getAttribute('form') ?? '';
    const form = formId ? document.getElementById(formId) : null;
    const next = document.querySelector(belowSelector);
    return {
      order: Boolean(search && sort && search.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING),
      sameForm: formId !== '' && sort?.getAttribute('form') === formId,
      formIsExposed: Boolean(form?.matches('form.views-exposed-form')),
      outside: !bar.closest('form'),
      above: Boolean(next && bar.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  }, below);
  expect(facts).toEqual({ order: true, sameForm: true, formIsExposed: true, outside: true, above: true });
  const barBox = await toolbar.boundingBox();
  const belowBox = await target.locator(below).first().boundingBox();
  expect(barBox!.y + barBox!.height, 'The toolbar does not sit above the rows').toBeLessThanOrEqual(belowBox!.y + 1);
}
