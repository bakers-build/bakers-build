// The team Stats tab: one period switch, and a chart that is actually painted.
//
// Navigation, login and the document-reload detector are NOT re-implemented
// here — `support/steps/shell.steps.ts` owns them and registering a second copy of a
// step text is a duplicate-definition error. This file adds only what is new:
// the switch, the figures and the canvas.
//
// WHY THE CANVAS IS READ AS PIXELS. A `<canvas>` has no DOM to assert against:
// its presence says the markup arrived, never that anything was drawn on it.
// The only evidence that Chart.js ran is the back-buffer, so these steps count
// the distinct opaque colours in it. That is also what makes the colour-mode
// scenario possible at all — the same read, before and after the switch.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The period switch's option links, wherever on the page they sit. */
const PERIOD_OPTION = 'a[data-filter-name="period"]';

/** The comparison chart's host element, which carries the model. */
const CHART_HOST = '[data-component-id="bb_theme:stat-comparison"] [data-stat-comparison]';

let notedFigures: string[] = [];
let notedBuckets: number[] = [];
let notedInk: string[] = [];

/**
 * One bucket count per chart figure, read from its own rendered model.
 *
 * This is what a period change is supposed to move: the figure set stays the
 * same, the number of categories behind it does not.
 */
async function bucketCounts(page: Page): Promise<number[]> {
  return page.locator(CHART_HOST).evaluateAll((nodes) =>
    nodes.map((node) => {
      const model = JSON.parse((node as HTMLElement).dataset.statComparison || '{}');
      return (model.labels || []).length;
    }),
  );
}

/**
 * The distinct opaque colours the chart canvas actually contains.
 *
 * Stray antialiasing is filtered by requiring a colour to cover more than a
 * handful of pixels, so the result is the ink of real lines and axes rather
 * than the blend between them.
 */
async function chartInk(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(`${selector} canvas`) as HTMLCanvasElement | null;
    if (!canvas) {
      return [];
    }
    const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) {
        continue;
      }
      const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n > 120).map(([key]) => key).sort();
  }, CHART_HOST);
}

Then('the statistics page has exactly one period switch', async ({ page }) => {
  await expect(page.locator(PERIOD_OPTION).first()).toBeVisible();
  const values = await page.locator(PERIOD_OPTION).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-filter-value')),
  );
  // One switch is one option per period, each appearing once. Two switches
  // would be the same options twice over.
  expect(new Set(values).size).toBe(values.length);
});

Then('no statistics figure carries a period switch of its own', async ({ page }) => {
  await expect(page.locator(`[data-statistics-figure] ${PERIOD_OPTION}`)).toHaveCount(0);
});

Given('I note the statistics figures', async ({ page }) => {
  await expect(page.locator('[data-statistics-figure]').first()).toBeVisible();
  notedFigures = await page
    .locator('[data-statistics-figure]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-statistics-figure') || ''));
  expect(notedFigures.length).toBeGreaterThan(1);
  notedBuckets = await bucketCounts(page);
  expect(notedBuckets.length).toBeGreaterThan(0);
});

When('I choose the period {string}', async ({ page }, label: string) => {
  await page.locator(PERIOD_OPTION).filter({ hasText: label }).first().click();
  await expect(
    page.locator(PERIOD_OPTION).filter({ hasText: label }).first(),
  ).toHaveAttribute('aria-current', 'true', { timeout: 10000 });
});

Then('the address carries the period {string}', async ({ page }, value: string) => {
  expect(decodeURIComponent(new URL(page.url()).search)).toContain(`filter[period]=${value}`);
});

Then('the period {string} is the current one', async ({ page }, label: string) => {
  const current = page.locator(`${PERIOD_OPTION}[aria-current="true"]`);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(label);
});

Then('the same statistics figures are shown', async ({ page }) => {
  const shown = await page
    .locator('[data-statistics-figure]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-statistics-figure') || ''));
  // Changing the period changes the VALUES of every figure, never which
  // figures apply — a switch that dropped figures would be a different defect.
  expect(shown).toEqual(notedFigures);
});

Then('every chart figure reports a different bucket count', async ({ page }) => {
  // The figure set must NOT change; what the switch has to move is the data
  // behind it. Daily buckets over a week and monthly buckets over a year can
  // never agree, so a switch wired per figure again fails right here.
  //
  // The counts are compared as a SET, not pairwise: a trend with no values in
  // the short window renders no canvas at all, so the number of charts on the
  // page is itself a function of the period.
  const noted = new Set(notedBuckets);
  await expect
    .poll(async () => (await bucketCounts(page)).filter((count) => noted.has(count)).length, {
      timeout: 10000,
    })
    .toBe(0);
  expect((await bucketCounts(page)).length).toBeGreaterThan(0);
});

Then('the comparison chart is painted', async ({ page }) => {
  await expect(page.locator(`${CHART_HOST} canvas`)).toHaveCount(1);
  await expect
    .poll(async () => (await chartInk(page)).length, { timeout: 10000 })
    // Two series plus the axis and grid ink. A canvas that was inserted and
    // never painted reports zero, which is the whole failure mode this guards.
    .toBeGreaterThanOrEqual(3);
});

Then('no comparison chart instance is left behind', async ({ page }) => {
  // A swapped-away host leaves the document, so its leaked Chart instance is
  // unreachable through the DOM — the behaviour's own registry is the only
  // place a leak is countable. One live chart per host in the document.
  const [live, hosts] = await page.evaluate(
    (selector) => [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).Drupal.behaviors.bakersStatComparison.live.size,
      document.querySelectorAll(selector).length,
    ],
    CHART_HOST,
  );
  expect(hosts).toBeGreaterThan(0);
  expect(live).toBe(hosts);
});

Then('the comparison chart spans the content width', async ({ page }) => {
  const [host, parent] = await page.locator(CHART_HOST).evaluate((node) => [
    node.clientWidth,
    (node.parentElement as HTMLElement).clientWidth,
  ]);
  expect(host).toBeGreaterThan(parent * 0.9);
});

Given('I note the chart ink', async ({ page }) => {
  await expect
    .poll(async () => (await chartInk(page)).length, { timeout: 10000 })
    .toBeGreaterThanOrEqual(3);
  notedInk = await chartInk(page);
});

When('I switch to the dark colour mode', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset.mode = 'dark';
  });
});

Then('the chart ink changed', async ({ page }) => {
  await expect
    .poll(async () => JSON.stringify(await chartInk(page)), { timeout: 10000 })
    .not.toBe(JSON.stringify(notedInk));
});
