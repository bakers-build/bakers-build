// Markdown output: stored bb_rich bodies rendered through `bb_theme:rich-text`.
//
// Reused from other files, deliberately not redefined here: `I am logged in as
// the account`, `I visit the ticket`, `I open the handoff stream`, `I go back`,
// `I click the rail entry`, `the document was not reloaded`, `the viewport is
// {int} pixels wide`, `I request
// the ticket … in the workspace …` and `the response status is`.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';

const MAIN = '[data-canvas-region="main"]';
const RICH_TEXT = '[data-component-id="bb_theme:rich-text"]';

/** The ticket description: the rich-text inside the About zone of the main region. */
function aboutBody(page: Page): Locator {
  return page.locator(`${MAIN} [data-component-id="bb_theme:zone"] ${RICH_TEXT}`);
}

function releaseTable(body: Locator): Locator {
  return body.getByRole('table').filter({ has: body.page().getByRole('columnheader', { name: 'Check', exact: true }) });
}

Then(
  'the description, the summary and {int} handoff comments render through rich-text',
  async ({ page }, handoffs: number) => {
    await expect(aboutBody(page)).toHaveCount(1);
    await expect(page.locator(`[data-component-id="bb_theme:summary-band"] ${RICH_TEXT}`)).toHaveCount(1);
    await expect(page.locator(`${MAIN} details.collapsible ${RICH_TEXT}`)).toHaveCount(handoffs);
  },
);

// Every body surface retains its table content and trailing prose.
Then('every rich-text body shows the release-check table', async ({ page }) => {
  const bodies = page.locator(RICH_TEXT);
  const count = await bodies.count();
  expect(count).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < count; i++) {
    const body = bodies.nth(i);
    await expect(releaseTable(body)).toBeVisible();
    await expect(body.getByRole('cell', { name: 'Passed', exact: true }).first()).toBeVisible();
    await expect(body).toContainText('Text after the table must remain visible.');
  }
});

Then('the About body has a table with the column headers {string}', async ({ page }, list: string) => {
  const headers = releaseTable(aboutBody(page)).locator('thead th');
  await expect(headers).toHaveText(list.split(', '));
});

Then(
  'the About body table has the rows {string} and {string} and {string}',
  async ({ page }, first: string, second: string, third: string) => {
    const rows = [first, second, third];
    const body = releaseTable(aboutBody(page)).locator('tbody tr');
    await expect(body).toHaveCount(rows.length);
    for (const [index, row] of rows.entries()) {
      // The literal `a|b` cell is the one place a pipe is content, not a separator.
      const cells = row.replace('a|b', 'a\u0000b').split('|').map((cell) => cell.replace('\u0000', '|'));
      await expect(body.nth(index).locator('td')).toHaveText(cells);
    }
  },
);

Then(
  'the About body shows a header-only table with the column headers {string}',
  async ({ page }, list: string) => {
    const table = aboutBody(page).getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Only', exact: true }) });
    await expect(table.locator('thead th')).toHaveText(list.split(', '));
    await expect(table.locator('td')).toHaveCount(0);
  },
);

Then('the About body shows {string}', async ({ page }, text: string) => {
  await expect(aboutBody(page)).toContainText(text);
});

// The rail persists its open state (`$persist` as bakers.sidebar), so a desktop
// scenario earlier on this worker would leave it open at 320px and squeeze the
// main region to a sliver. A first-time narrow reader starts with it closed.
Given('the navigation rail has no remembered state', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('bakers.sidebar');
    localStorage.removeItem('_x_bakers.sidebar');
  });
});

// Measured against a baseline, as the plan requires: the same document with
// every body hidden. An unrelated shell overflow (an expanded sidebar at 320px
// pushes the inspector's buttons out) then cannot hide or fake a body overflow.
Then('the rich-text bodies add no horizontal page overflow', async ({ page }) => {
  await page.waitForLoadState('load');
  const { withBodies, withoutBodies, widest } = await page.evaluate((selector) => {
    const bodies = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const withBodies = document.documentElement.scrollWidth;
    const widest = Math.max(...bodies.map((b) => b.getBoundingClientRect().width - (b.parentElement?.clientWidth ?? 0)));
    bodies.forEach((b) => { b.style.display = 'none'; });
    const withoutBodies = document.documentElement.scrollWidth;
    bodies.forEach((b) => { b.style.display = ''; });
    return { withBodies, withoutBodies, widest };
  }, RICH_TEXT);
  expect(withBodies, 'a body widened the document').toBeLessThanOrEqual(withoutBodies);
  expect(widest, 'a body is wider than its container').toBeLessThanOrEqual(1);
});

Then('the About body is a named, focusable scroll region wider than its viewport', async ({ page }) => {
  const body = aboutBody(page);
  await expect(body).toHaveAttribute('role', 'region');
  await expect(body).toHaveAttribute('tabindex', '0');
  await expect(body).toHaveAccessibleName('Description');
  const { scroll, client, overflowX } = await body.evaluate((e) => ({
    scroll: e.scrollWidth,
    client: e.clientWidth,
    overflowX: getComputedStyle(e).overflowX,
  }));
  expect(overflowX).toBe('auto');
  expect(scroll, 'the wide table is wider than the body, so the body must scroll').toBeGreaterThan(client);
});

Then('the table scroll regions have distinct accessible names', async ({ page }) => {
  const regions = page.locator(`${RICH_TEXT}[role="region"]`);
  const count = await regions.count();
  expect(count).toBeGreaterThanOrEqual(4);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    names.push((await regions.nth(i).getAttribute('aria-label')) ?? '');
  }
  expect(names.every((name) => name.length > 0), `empty region names: ${JSON.stringify(names)}`).toBe(true);
  expect(new Set(names).size, `duplicate region names: ${JSON.stringify(names)}`).toBe(names.length);
});

When('I focus the About body and scroll it right with the keyboard', async ({ page }) => {
  const body = aboutBody(page);
  await body.focus();
  await expect(body).toBeFocused();
  const outline = await body.evaluate((e) => {
    const style = getComputedStyle(e);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor, background: style.backgroundColor };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
  expect(outline.color).not.toBe(outline.background);
  // Native arrow-key scrolling, no script: press until the region reaches its end.
  for (let i = 0; i < 100; i++) {
    const atEnd = await body.evaluate((e) => e.scrollLeft + e.clientWidth >= e.scrollWidth - 1);
    if (atEnd) break;
    await page.keyboard.press('ArrowRight');
  }
});

Then('the column header {string} of the About body is inside its scroll region', async ({ page }, name: string) => {
  const body = aboutBody(page);
  await expect.poll(() => body.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  const header = body.getByRole('columnheader', { name, exact: true });
  await expect.poll(async () => {
    const [b, h] = await Promise.all([body.boundingBox(), header.boundingBox()]);
    return !!b && !!h && h.x >= b.x - 1 && h.x + h.width <= b.x + b.width + 1
      ? 'inside'
      : `header ${JSON.stringify(h)} outside region ${JSON.stringify(b)}`;
  }).toBe('inside');
});

Then('the About body is not clamped and offers no Show more toggle', async ({ page }) => {
  const body = aboutBody(page);
  await expect(body).toBeVisible();
  await expect(page.locator(MAIN).getByRole('button', { name: 'Show more' })).toHaveCount(0);
  // Vertical containment: a line-clamp on this body would push later rows
  // below the region's box. Horizontal overflow is asserted elsewhere.
  const rows = releaseTable(body).locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  const bodyBox = await body.boundingBox();
  expect(bodyBox, 'the About body has no box').toBeTruthy();
  for (let i = 0; i < count; i++) {
    const rowBox = await rows.nth(i).boundingBox();
    expect(rowBox, `row ${i} has no box`).toBeTruthy();
    expect(rowBox!.y, `row ${i} starts above the body`).toBeGreaterThanOrEqual(bodyBox!.y - 1);
    expect(
      rowBox!.y + rowBox!.height,
      `row ${i} extends below the body`,
    ).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height + 1);
  }
});

Then('the About body shows the formatting corpus', async ({ page }) => {
  const body = aboutBody(page);
  for (const selector of ['h3', 'h4', 'ul ul', 'ol', 'p a', 'blockquote', 'hr', 'p code', 'pre code']) {
    await expect(body.locator(selector).first()).toBeVisible();
  }
  await expect(body.locator('pre code')).toContainText('<script>alert("literal")</script>');
});

Then('no injected script ran', async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { __markdownXss?: boolean }).__markdownXss)).toBeUndefined();
});

Then('the About body contains no script, image or javascript link', async ({ page }) => {
  const body = aboutBody(page);
  await expect(body).toContainText('Safe text before.');
  await expect(body.locator('script, img, [onerror]')).toHaveCount(0);
  await expect(body.locator('a[href^="javascript"]')).toHaveCount(0);
});

Then('the About body code block reads {string}', async ({ page }, text: string) => {
  await expect(aboutBody(page).locator('pre code')).toHaveText(text);
  await expect(aboutBody(page).locator('pre b')).toHaveCount(0);
});

Then('no About body is rendered', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Markdown output without description');
  await expect(page.locator(`${MAIN} ${RICH_TEXT}`)).toHaveCount(0);
});

Then('the page does not show {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toHaveCount(0);
});

/** The stored source of a ticket's description and its comments, as JSON. */
function storedMarkdown(identifier: string): string {
  return php(
    '$t = current(\\Drupal::entityTypeManager()->getStorage("bb_ticket")' +
      `->loadByProperties(["identifier" => "${safe(identifier)}"]));` +
      '$out = ["description" => $t->get("description")->getValue()];' +
      '$ids = \\Drupal::entityQuery("bb_comment")->accessCheck(FALSE)->condition("ticket_id", $t->id())->sort("id")->execute();' +
      'foreach (\\Drupal::entityTypeManager()->getStorage("bb_comment")->loadMultiple($ids) as $c) { $out[$c->uuid()] = $c->get("body")->getValue(); }' +
      'print json_encode($out);',
  );
}

let remembered: string | null = null;

Given('the stored Markdown of {string} and its comments is remembered', async ({}, identifier: string) => {
  remembered = storedMarkdown(identifier);
  const parsed = JSON.parse(remembered) as Record<string, Array<{ value: string; format: string }>>;
  expect(Object.keys(parsed)).toHaveLength(4);
  expect(parsed.description[0].value).toContain('| Check | Result | Notes |');
});

Then(
  'the stored Markdown of {string} and its comments is unchanged and still bb_rich',
  async ({}, identifier: string) => {
    const now = storedMarkdown(identifier);
    expect(now).toBe(remembered);
    const parsed = JSON.parse(now) as Record<string, Array<{ format: string }>>;
    for (const value of Object.values(parsed)) {
      expect(value[0].format).toBe('bb_rich');
    }
  },
);
