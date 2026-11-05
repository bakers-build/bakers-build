// The four workspace listings as `bb_theme:list` rows with one sort dropdown.
// Consumer: features/workspace/listing-rows.feature. `I am signed in as a
// member of the {string} workspace` comes from support/steps/listing.steps.ts.
import { Given, When, Then } from '../../bdd.fixtures';
import { Drush } from '../../support/drush';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { closedControl, expectToolbarAbove, resetOverridePage, SEARCH_TOOLBAR } from '../../support/listing';
import { CONTENT_ISLAND } from '../../support/shell';

type RowListing = 'Projects' | 'Groups' | 'Tickets' | 'Runs';

const LIST = `${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`;
const ROW = `${LIST} li[data-list-item]`;

/** The listing in context, its address and the last detail target followed. */
const state: {
  listing: RowListing | null;
  path: string;
  detail: string;
  status: number;
  key: string;
  baseline: number;
  query: string;
  matches: string[];
} = {
  listing: null,
  path: '',
  detail: '',
  status: 0,
  key: '',
  baseline: 0,
  query: '',
  matches: [],
};

function rowListing(name: string): RowListing {
  if (!['Projects', 'Groups', 'Tickets', 'Runs'].includes(name)) {
    throw new Error(`Unknown listing "${name}".`);
  }
  return name as RowListing;
}

function listingPath(listing: RowListing): string {
  switch (listing) {
    case 'Projects':
      return '/bakers/projects';
    case 'Groups':
      return '/bakers/groups';
    case 'Tickets':
      return '/bakers/tickets/all';
    case 'Runs': {
      const url = php(
        'print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")' +
          '->loadByProperties(["name" => "bakers-e2e-project"]))) ? $e->toUrl()->toString() : "");',
      );
      if (!url) {
        throw new Error('No bb_project named "bakers-e2e-project" exists in the seeded world.');
      }
      return `${url}/runs`;
    }
  }
}

function sortSelect(page: Page): Locator {
  return page.locator(`${CONTENT_ISLAND} ${SEARCH_TOOLBAR} select[name="sort_bef_combine"]`);
}

function searchField(page: Page): Locator {
  return page.locator(`${CONTENT_ISLAND} ${SEARCH_TOOLBAR}`).locator('input[name="title"]');
}

/** Waits until no htmx request is in flight and the rows are back. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('.htmx-request'), null, { timeout: 20000 });
  await expect(page.locator(LIST).first()).toBeAttached({ timeout: 20000 });
}

/** A row value without its visible label, read off `[data-cell="key"]`. */
async function rowValues(page: Page, key: string): Promise<string[]> {
  return page.locator(`${ROW} [data-cell="${key}"]`).evaluateAll((cells) =>
    cells.map((cell) => {
      const copy = cell.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[data-cell-label]').forEach((label) => label.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    }),
  );
}

/** Identity of every row on the page: its first link target. */
async function rowTargets(page: Page): Promise<string[]> {
  return page.locator(ROW).evaluateAll((rows) =>
    rows.map((row) => row.querySelector('a[href]')?.getAttribute('href') ?? ''),
  );
}

// ponytail: case-insensitive code-point order; matches the seeded values under
// MariaDB's general_ci and Search API's string columns, not full ICU collation.
function ordered(values: string[], direction: 'ascending' | 'descending'): boolean {
  return values.every((value, i) => {
    if (i === 0) {
      return true;
    }
    const [a, b] = [values[i - 1].toLowerCase(), value.toLowerCase()];
    return direction === 'ascending' ? a <= b : a >= b;
  });
}

async function chooseSort(page: Page, value: string): Promise<void> {
  const select = sortSelect(page);
  await expect(select, 'No "Sort by" dropdown on this listing').toBeVisible();
  await select.selectOption(value);
  await expect.poll(() => new URL(page.url()).searchParams.get('sort_bef_combine'), { timeout: 20000 }).toBe(value);
  await settle(page);
}

Given('the listing indexes are up to date', async () => {
  resetOverridePage();
  Drush.exec('search-api:index bb_tickets');
  Drush.exec('search-api:index bb_runs');
});

// `the viewport is {int} pixels wide` is the shared step in
// steps/sign-in/gate-presentation.steps.ts.

/** Drops the sidebar's persisted open state before the next page loads. */
Given('the rail has no remembered state', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem('bakers.sidebar'));
});

When('I open the {string} row listing', async ({ page }, name: string) => {
  state.listing = rowListing(name);
  state.path = listingPath(state.listing);
  const response = await page.goto(state.path);
  state.status = response?.status() ?? 0;
  expect(state.status, `The ${name} listing did not render`).toBeLessThan(400);
  await settle(page);
});

When(
  'I open the {string} row listing with the sort value {string}',
  async ({ page }, name: string, value: string) => {
    state.listing = rowListing(name);
    state.path = listingPath(state.listing);
    const response = await page.goto(`${state.path}?sort_bef_combine=${encodeURIComponent(value)}`);
    state.status = response?.status() ?? 0;
  },
);

Then('the listing answered without a server error', async () => {
  expect(state.status).toBeLessThan(500);
});

Then('the sort dropdown is marked invalid', async ({ page }) => {
  await expect(sortSelect(page)).toHaveAttribute('aria-invalid', 'true');
});

Then('no row is listed', async ({ page }) => {
  await expect(page.locator(ROW)).toHaveCount(0);
});

Then('the rows are list items and no table is rendered', async ({ page }) => {
  await expect.poll(() => page.locator(ROW).count(), { timeout: 10000 }).toBeGreaterThan(0);
  await expect(page.locator(`${CONTENT_ISLAND} table`)).toHaveCount(0);
  await expect(page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:table"]`)).toHaveCount(0);
});

/**
 * The toolbar is the first thing above the rows: on tickets and runs it also
 * precedes the active-filter chips, which sit between it and the list.
 */
Then('the search toolbar sits directly above the rows', async ({ page }) => {
  const chips = page.locator(`${CONTENT_ISLAND} [data-facet]`);
  const below = (await chips.count()) > 0 ? `${CONTENT_ISLAND} [data-facet]` : LIST;
  await expectToolbarAbove(page, CONTENT_ISLAND, below);
  await expect(page.getByLabel('Sort by', { exact: true })).toHaveCount(1);
});

When('I sort the listing by {string}', async ({ page }, value: string) => {
  await chooseSort(page, value);
});

Then('the sort dropdown still reads {string}', async ({ page }, value: string) => {
  await expect(sortSelect(page)).toHaveValue(value, { timeout: 20000 });
  expect(new URL(page.url()).searchParams.get('sort_bef_combine')).toBe(value);
});

Then(
  'the rows are ordered {word} by their {string} value',
  async ({ page }, direction: string, key: string) => {
    if (direction !== 'ascending' && direction !== 'descending') {
      throw new Error(`Unknown direction "${direction}".`);
    }
    state.key = key;
    const values = await rowValues(page, key);
    expect(values.length, `No "${key}" values on the listing`).toBeGreaterThan(1);
    expect(ordered(values, direction), `Rows are not ${direction}: ${values.join(' | ')}`).toBe(true);
  },
);

/**
 * Projects and groups filter through the toolbar search (Enter submits the
 * exposed form it is bound to); tickets and runs by the closed-rows control, a link whose address
 * must carry the chosen order along.
 */
When("I apply the listing's sample filter", async ({ page }) => {
  if (state.listing === 'Projects' || state.listing === 'Groups') {
    const field = searchField(page);
    await field.fill('a');
    await field.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('title'), { timeout: 20000 }).toBe('a');
  }
  else {
    await closedControl(page).getByRole('link', { name: 'All', exact: true }).click();
    await expect(closedControl(page).getByRole('link', { name: 'All', exact: true }))
      .toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  }
  await settle(page);
});

/**
 * Follows "Next page" when there is one, and checks the page boundary: the
 * next page continues the order and repeats no row of the previous one.
 */
When('I page forward if the listing has another page', async ({ page }) => {
  const next = page.locator(CONTENT_ISLAND).getByRole('link', { name: 'Next page', exact: true });
  if (await next.count() === 0) {
    return;
  }
  const value = new URL(page.url()).searchParams.get('sort_bef_combine') ?? '';
  const cell = state.key;
  const before = await rowValues(page, cell);
  const beforeTargets = await rowTargets(page);
  await next.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('page'), { timeout: 20000 }).toBe('1');
  await settle(page);
  const after = await rowValues(page, cell);
  const afterTargets = await rowTargets(page);
  const direction = value.endsWith('_DESC') ? 'descending' : 'ascending';
  expect(ordered([before[before.length - 1], after[0]], direction), 'The next page does not continue the order').toBe(true);
  // Runs link to their ticket, so two runs may share a target; their rows differ.
  if (state.listing !== 'Runs') {
    expect(afterTargets.filter((target) => beforeTargets.includes(target)), 'A row repeats across pages').toEqual([]);
  }
});

When('I reload the row listing', async ({ page }) => {
  await page.reload();
  await settle(page);
});

When("I follow the first row's {string} link", async ({ page }, key: string) => {
  const link = page.locator(`${ROW} [data-cell="${key}"] a[href]`).first();
  await expect(link).toBeVisible();
  state.detail = (await link.getAttribute('href')) ?? '';
  expect(state.detail).not.toBe('');
  await link.click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).not.toBe(state.path);
});

When("I click the first row outside its links", async ({ page }) => {
  const row = page.locator(ROW).first();
  await expect(row).toBeVisible();
  state.detail = (await row.locator('[data-list-region="headline"] a[href]').first().getAttribute('href')) ?? '';
  expect(state.detail, 'The first row has no headline link to forward to').not.toBe('');
  // The leading rail is part of the row and holds no control.
  const box = await row.boundingBox();
  await row.click({ position: { x: 2, y: Math.round((box?.height ?? 20) / 2) } });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).not.toBe(state.path);
});

When('I return to the row listing', async ({ page }) => {
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20000 }).toBe(new URL(state.path, page.url()).pathname);
  await settle(page);
});

Then('the detail page of that row is shown', async ({ page }) => {
  // A project's canonical route redirects to its Tickets tab.
  expect(new URL(page.url()).pathname.startsWith(new URL(state.detail, page.url()).pathname)).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

Then("the first row's {string} value is fully visible", async ({ page }, key: string) => {
  const cell = page.locator(`${ROW} [data-cell="${key}"]`).first();
  await expect(cell).toBeVisible();
  const box = await cell.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, 'The first row value has no box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'The first row value runs past the viewport').toBeLessThanOrEqual(width + 1);
});

/** Polls past the load's own reflow; the message names what overflows. */
Then('the document does not scroll horizontally', async ({ page }) => {
  await page.waitForLoadState('load');
  await expect.poll(() => page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width) {
      return 'none';
    }
    const wide = Array.from(document.querySelectorAll('body *'))
      .filter((element) => element.getBoundingClientRect().right > width + 1)
      .slice(-3)
      .map((element) => `${element.tagName}[${element.getAttribute('data-component-id') ?? element.getAttribute('data-cell') ?? ''}]`);
    return `scrollWidth ${document.documentElement.scrollWidth} > ${width}: ${wide.join(', ')}`;
  }), { timeout: 5000 }).toBe('none');
});

When('I move the sort dropdown one option down with the keyboard', async ({ page }) => {
  const select = sortSelect(page);
  const before = await select.inputValue();
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => new URL(page.url()).searchParams.get('sort_bef_combine'), { timeout: 20000 }).not.toBe(before);
  await settle(page);
});

/** The row whose headline names a label. */
function namedRow(page: Page, name: string): Locator {
  return page.locator(ROW).filter({
    has: page.locator('[data-list-region="headline"] [data-cell="name"]', { hasText: new RegExp(`^\\s*${name}\\s*$`) }),
  });
}

Then('every row starts with its avatar', async ({ page }) => {
  const firsts = await page.locator(ROW).evaluateAll((rows) =>
    rows.map((row) => row.querySelector('[data-list-region]')?.getAttribute('data-list-region') ?? ''),
  );
  expect(firsts.length, 'The listing has no row').toBeGreaterThan(0);
  expect(new Set(firsts)).toEqual(new Set(['avatar']));
  const marks = await page.locator(`${ROW} [data-list-region="avatar"]`).evaluateAll((regions) =>
    regions.map((region) => (region.querySelector('img[src]') ? 'image' : (region.textContent ?? '').trim() ? 'initials' : '')),
  );
  expect(marks, 'An avatar is neither an image nor initials').not.toContain('');
});

Then(
  'the row {string} shows the description {string} beneath its title',
  async ({ page }, name: string, fragment: string) => {
    const row = namedRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-list-region="description"]')).toContainText(fragment);
    const order = await row.locator('[data-list-region]').evaluateAll((regions) =>
      regions.map((region) => region.getAttribute('data-list-region')),
    );
    expect(order.indexOf('description')).toBeGreaterThan(order.indexOf('headline'));
  },
);

// Every count is a badge with an icon whose title says what it counts, and the
// date sits beneath the counts, right-aligned with them.
Then(
  'every row shows the counts {string} with an icon and beneath them {string}',
  async ({ page }, meanings: string, caption: string) => {
    const expected = meanings.split(' · ').map((meaning) => new RegExp(`^\\d+ ${meaning}$`));
    const rows = await page.locator(ROW).evaluateAll((items) =>
      items.map((item) => {
        const badges = [...item.querySelectorAll('[data-list-region="right"] [data-component-id="bb_theme:badge"]')];
        const right = item.querySelector('[data-list-region="right"]')?.getBoundingClientRect();
        const below = item.querySelector('[data-list-region="right_meta"]');
        const box = below?.getBoundingClientRect();
        return {
          titles: badges.map((badge) => badge.getAttribute('title') ?? ''),
          icons: badges.filter((badge) => badge.querySelector('svg')).length,
          caption: (below?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          beneath: right && box ? box.top >= right.bottom - 1 : false,
        };
      }),
    );
    expect(rows.length, 'The listing rendered no row').toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.titles).toHaveLength(expected.length);
      row.titles.forEach((title, index) => expect(title).toMatch(expected[index]));
      expect(row.icons, 'A count has no icon').toBe(expected.length);
      expect(row.caption).toMatch(new RegExp(`^${caption} .+ ago$`));
      expect(row.beneath, 'The date does not sit beneath the counts').toBe(true);
    }
  },
);

Then('a row without a description shows no description region', async ({ page }) => {
  const shapes = await page.locator(ROW).evaluateAll((rows) =>
    rows.map((row) => {
      const region = row.querySelector('[data-list-region="description"]');
      return region === null ? 'absent' : (region.textContent ?? '').trim() ? 'filled' : 'empty';
    }),
  );
  expect(shapes, 'An empty description region was rendered').not.toContain('empty');
  expect(shapes, 'No seeded row lacks a description').toContain('absent');
});

/** Polls past the load's own reflow (web fonts, images); the message names the part. */
Then(
  'the row {string} keeps its avatar left of its headline and inside the row',
  async ({ page }, name: string) => {
    const row = namedRow(page, name);
    await expect(row).toHaveCount(1);
    await page.waitForLoadState('load');
    await expect.poll(() => row.evaluate((li) => {
      const box = li.getBoundingClientRect();
      const part = (region: string) => li.querySelector(`[data-list-region="${region}"]`)?.getBoundingClientRect();
      const avatar = part('avatar');
      const headline = part('headline');
      const description = part('description');
      if (!avatar || !headline || !description) return 'a region is missing';
      if (avatar.right > headline.left + 1) return 'the avatar is not left of the headline';
      for (const [label, rect] of [['avatar', avatar], ['headline', headline], ['description', description]] as const) {
        if (rect.left < box.left - 1 || rect.right > box.right + 1) return `the ${label} leaves the row (${Math.round(rect.left)}-${Math.round(rect.right)} of ${Math.round(box.left)}-${Math.round(box.right)})`;
      }
      return li.scrollWidth <= li.clientWidth + 1 ? 'inside' : 'the row scrolls horizontally';
    }), { timeout: 5000 }).toBe('inside');
  },
);

/**
 * What the search should find, asked of the backend rather than read off
 * the rows: projects match name or key, groups the name, tickets the title
 * by word, runs their ticket's title by word. Returns row link targets.
 */
function expectedMatches(listing: RowListing, query: string): string[] {
  const q = query.replace(/["'\\$]/g, '');
  const snippets: Record<RowListing, string> = {
    Projects: `$ws = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"])); foreach ($etm->getStorage("bb_project")->loadMultiple() as $e) { $g = $e->get("group_id")->entity; if ($g && (int) $g->get("workspace_id")->target_id === (int) $ws->id() && (stripos($e->label(), "${q}") !== FALSE || stripos((string) $e->get("key")->value, "${q}") !== FALSE)) { $out[] = $e->toUrl()->toString(); } }`,
    Groups: `$ws = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"])); foreach ($etm->getStorage("bb_group")->loadByProperties(["workspace_id" => $ws->id()]) as $e) { if (stripos($e->label(), "${q}") !== FALSE) { $out[] = $e->toUrl()->toString(); } }`,
    Tickets: `$words = preg_split("/\\s+/", strtolower("${q}")); foreach ($etm->getStorage("bb_ticket")->loadMultiple() as $e) { $t = preg_split("/\\W+/", strtolower((string) $e->get("title")->value)); if (!array_diff($words, $t)) { $out[] = $e->toUrl()->toString(); } }`,
    Runs: `$words = preg_split("/\\s+/", strtolower("${q}")); foreach ($etm->getStorage("bb_run")->loadMultiple() as $r) { $e = $r->get("ticket_id")->entity; if (!$e) { continue; } $t = preg_split("/\\W+/", strtolower((string) $e->get("title")->value)); if (!array_diff($words, $t)) { $out[] = $e->toUrl()->toString(); } }`,
  };
  return php(`$etm = \\Drupal::entityTypeManager(); $out = []; ${snippets[listing]} print implode(",", array_unique($out));`)
    .split(',')
    .filter((target) => target !== '');
}

/** The first link target of every row, minus any query string. */
async function rowLinks(page: Page): Promise<string[]> {
  return (await rowTargets(page)).map((target) => target.split('?')[0]);
}

When('I note the listed row count', async ({ page }) => {
  state.baseline = await page.locator(ROW).count();
  expect(state.baseline, 'There are no rows to narrow').toBeGreaterThan(1);
});

/** Types into the toolbar search and lets its auto-submit fire. */
When('I type {string} into the listing search', async ({ page }, query: string) => {
  state.query = query;
  state.matches = expectedMatches(state.listing!, query);
  expect(state.matches.length, `Nothing in the seed matches "${query}"`).toBeGreaterThan(0);
  await searchField(page).pressSequentially(query, { delay: 30 });
  await expect.poll(() => new URL(page.url()).searchParams.get('title'), { timeout: 20000 }).toBe(query);
  await settle(page);
});

Then('only rows matching the search are listed', async ({ page }) => {
  await expect(searchField(page)).toHaveValue(state.query, { timeout: 20000 });
  expect(new URL(page.url()).searchParams.get('title')).toBe(state.query);
  const shown = await rowLinks(page);
  expect(shown.length, 'The search listed nothing').toBeGreaterThan(0);
  expect(shown.length, 'The search did not narrow the rows').toBeLessThan(state.baseline);
  for (const target of shown) {
    expect(state.matches, `${target} does not match "${state.query}"`).toContain(target);
  }
});

When('I show all rows with the closed control where the listing has one', async ({ page }) => {
  if (state.listing === 'Projects' || state.listing === 'Groups') {
    return;
  }
  await closedControl(page).getByRole('link', { name: 'All', exact: true }).click();
  await expect(closedControl(page).getByRole('link', { name: 'All', exact: true }))
    .toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  await settle(page);
});

When('I clear the listing search', async ({ page }) => {
  const field = searchField(page);
  await field.fill('');
  await field.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('title') ?? '', { timeout: 20000 }).toBe('');
  await settle(page);
});

Then('the rows before the search are listed again', async ({ page }) => {
  await expect(searchField(page)).toHaveValue('');
  await expect.poll(() => page.locator(ROW).count(), { timeout: 20000 }).toBeGreaterThanOrEqual(state.baseline);
});

Then('every ticket row leads with a state glyph named by its state', async ({ page }) => {
  const glyphs = await page.locator(ROW).evaluateAll((items) =>
    items.map((item) => {
      const glyph = item.querySelector('[data-list-region="avatar"] [role="img"]');
      return glyph ? `${glyph.getAttribute('title')}|${glyph.getAttribute('aria-label')}|${glyph.querySelector('svg') ? 'svg' : ''}` : '';
    }),
  );
  expect(glyphs.length, 'The listing rendered no row').toBeGreaterThan(0);
  for (const glyph of glyphs) {
    expect(glyph).toMatch(/^([^|]+)\|\1\|svg$/);
  }
});

Then('every ticket row reads its identifier and {string} beneath the title', async ({ page }, caption: string) => {
  const [word] = caption.split(' ');
  const rows = await page.locator(ROW).evaluateAll((items) =>
    items.map((item) => ({
      identifier: (item.querySelector('[data-list-region="meta"] [data-cell="identifier"]')?.textContent ?? '').trim(),
      created: (item.querySelector('[data-list-region="meta"] [data-cell="created"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      headlineBottom: item.querySelector('[data-list-region="headline"]')?.getBoundingClientRect().bottom ?? 0,
      metaTop: item.querySelector('[data-list-region="meta"]')?.getBoundingClientRect().top ?? -1,
    })),
  );
  for (const row of rows) {
    expect(row.identifier, "A row has no identifier").toMatch(/^\S+$/);
    expect(row.created).toMatch(new RegExp(`^${word} .+ (ago|hence)$`));
    expect(row.metaTop, 'The meta line does not sit beneath the title').toBeGreaterThanOrEqual(row.headlineBottom - 1);
  }
});

Then("every ticket row ends with the assignee's mark, named by its tooltip", async ({ page }) => {
  const marks = await page.locator(ROW).evaluateAll((items) =>
    items.map((item) => {
      const mark = item.querySelector('[data-list-region="right"] [data-cell="assignee"] [role="img"]');
      return mark ? { title: mark.getAttribute('title') ?? '', text: (mark.textContent ?? '').trim() } : null;
    }),
  );
  for (const mark of marks) {
    expect(mark, 'A row has no assignee mark').not.toBeNull();
    expect(mark!.title.length).toBeGreaterThan(0);
    expect(mark!.text.length, 'The mark shows more than initials').toBeLessThanOrEqual(3);
  }
});
