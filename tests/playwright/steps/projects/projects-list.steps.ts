// Groups and Projects listings: each page is one Views page display.
//
// ONLY THE STEPS support/steps/shell.steps.ts DOES NOT ALREADY PROVIDE. That file
// already defines `I visit the team`, `the application shell is present`,
// `the shell rail is present`, `the document was not reloaded`, `the address
// ends with`, `the rail marks … as current` and `I click the rail entry`.
// `I am signed in as a member of the {string} workspace` and `the address
// carries` come from support/steps/listing.steps.ts. `the page heading is` comes from
// support/steps/shell.steps.ts.
import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { expectToolbarAbove, SEARCH_TOOLBAR } from '../../support/listing';
import { CONTENT_ISLAND, markDocument, RAIL_ISLAND } from '../../support/shell';

type Listing = 'Groups' | 'Projects';

const LISTINGS: Record<Listing, {
  path: string;
  formId: string;
  empty: string;
  alpha: string;
  beta: string;
  foreign: string;
}> = {
  Groups: {
    path: 'groups',
    formId: 'views-exposed-form-groups-workspace-list',
    empty: 'No groups found.',
    alpha: 'Alpha Billing',
    beta: 'Beta Billing',
    foreign: 'Alpha Other',
  },
  Projects: {
    path: 'projects',
    formId: 'views-exposed-form-projects-workspace-list',
    empty: 'No projects found.',
    alpha: 'Alpha North',
    beta: 'Beta South',
    foreign: 'Alpha Other',
  },
};

/** The listing the last open/visit/search step addressed. */
let currentListing: Listing | null = null;
let baselineRowCount: number | null = null;
let lastListingStatus: number | null = null;

function listingOf(name: string): Listing {
  if (name !== 'Groups' && name !== 'Projects') {
    throw new Error(`Unknown listing "${name}" — expected Groups or Projects.`);
  }
  return name;
}

function listingFormId(listing: Listing): string {
  return LISTINGS[listing].formId;
}

/**
 * The Views render-element wrapper for one listing page.
 *
 * Page displays go through `#type => view` with `#embed => FALSE`, which adds
 * `views-element-container`. Display Builder then fills that wrapper, so the
 * exposed form id is the stable identity of which view it is — never a
 * controller marker and never "the second table".
 */
function listingWrapper(page: Page, listing: Listing): Locator {
  return page
    .locator(`${CONTENT_ISLAND} .views-element-container`)
    .filter({ has: page.locator(`#${listingFormId(listing)}`) });
}

function listingForm(page: Page, listing: Listing): Locator {
  return listingWrapper(page, listing).locator(`#${listingFormId(listing)}`);
}

/** The listing's `bb_theme:list`; rows are its `li[data-list-item]`. */
function listingList(page: Page, listing: Listing): Locator {
  return listingWrapper(page, listing).locator('[data-component-id="bb_theme:list"]');
}

function listingRows(page: Page, listing: Listing): Locator {
  return listingList(page, listing).locator('li[data-list-item]');
}

/** The toolbar's search field; it submits the exposed form by `form=`. */
function titleField(page: Page, listing: Listing): Locator {
  return listingWrapper(page, listing).locator(SEARCH_TOOLBAR).locator('input[name="title"]');
}

function requireListing(): Listing {
  if (currentListing === null) {
    throw new Error('No listing is in context — open or visit Groups or Projects first.');
  }
  return currentListing;
}

async function waitForListing(page: Page, listing: Listing): Promise<void> {
  await expect(
    listingWrapper(page, listing),
    `The ${listing} View wrapper did not render`,
  ).toBeAttached({ timeout: 20000 });
  await expect(listingForm(page, listing)).toBeAttached({ timeout: 20000 });
}

async function searchTitle(page: Page, query: string): Promise<void> {
  const listing = requireListing();
  const form = listingForm(page, listing);
  const field = titleField(page, listing);
  await expect(field, `No search field on the ${listing} listing`).toBeVisible();
  // ENTER, NOT A BUTTON. The exposed form runs Better Exposed Filters with
  // `autosubmit_hide`, so there is no submit control to click — and autosubmit
  // itself only fires above its minimum length, which an empty "clear the
  // search" submission is below. Enter submits the form in both cases and is
  // what a reader does anyway.
  await expect(
    form.getByRole('button', { name: 'Search', exact: true }),
    'The listing still renders a Search submit — autosubmit should have hidden it',
  ).toHaveCount(0);
  await field.fill(query);
  await field.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('.htmx-request'),
    null,
    { timeout: 20000 },
  );
  await waitForListing(page, listing);
  if (query !== '') {
    await expect.poll(() => decodeURIComponent(new URL(page.url()).search)).toContain(`title=${query}`);
  }
  await expect(titleField(page, listing)).toHaveValue(query);
}

Given('I am logged in as a member of the listing fixture workspace', async ({ page, authProvider }) => {
  // Same recipe reader the shared workspace-member step uses for "bakers".
  const uid = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      '$ws = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"]));',
      '$u = current($etm->getStorage("user")->loadByProperties(["name" => "north-lead"]));',
      'if ($ws && $u && (int) $u->id() > 1 && \\Drupal::service("og.membership_manager")->isMember($ws, $u->id())) {',
      'print $u->id(); }',
    ].join(' '),
  );
  if (!uid || uid === '0') {
    throw new Error('Recipe reader "north-lead" must be a member of the "bakers" workspace.');
  }
  await authProvider.login(page, uid);
});

When('I visit the {string} listing', async ({ page }, name: string) => {
  const listing = listingOf(name);
  const response = await page.goto(`/bakers/${LISTINGS[listing].path}`);
  lastListingStatus = response?.status() ?? 0;
  expect(lastListingStatus, `The ${listing} listing did not render`).toBeLessThan(400);
  currentListing = listing;
  await waitForListing(page, listing);
  await markDocument(page);
  baselineRowCount = await listingRows(page, listing).count();
});

When('I visit the {string} listing of the {string} workspace', async ({ page }, name: string, slug: string) => {
  const listing = listingOf(name);
  currentListing = listing;
  const response = await page.goto(`/${slug}/${LISTINGS[listing].path}`);
  lastListingStatus = response?.status() ?? 0;
});

When('I open the {string} rail entry', async ({ page }, name: string) => {
  const listing = listingOf(name);
  const response = await page.goto('/bakers/tickets');
  expect(response?.status() ?? 0, 'My work did not render').toBeLessThan(400);
  await expect(page.locator(RAIL_ISLAND)).toBeVisible();
  await markDocument(page);
  await page.locator(RAIL_ISLAND).getByRole('link', { name: listing }).click();
  await expect(
    page.locator(`${RAIL_ISLAND} [aria-current]`).filter({ hasText: listing }).first(),
  ).toBeAttached({ timeout: 10000 });
  currentListing = listing;
  await waitForListing(page, listing);
  baselineRowCount = await listingRows(page, listing).count();
});

When('I search the listing for {string}', async ({ page }, query: string) => {
  await searchTitle(page, query);
});

When('I clear the search and submit', async ({ page }) => {
  await searchTitle(page, '');
});

When('I reload the listing', async ({ page }) => {
  const listing = requireListing();
  await page.reload();
  if (lastListingStatus !== null && lastListingStatus >= 400) {
    return;
  }
  await waitForListing(page, listing);
});

Then('only the {string} listing is visible', async ({ page }, name: string) => {
  const listing = listingOf(name);
  currentListing = listing;
  await waitForListing(page, listing);
  const other: Listing = listing === 'Groups' ? 'Projects' : listing === 'Projects' ? 'Groups' : 'Groups';
  await expect(
    page.locator(`#${listingFormId(other)}`),
    `The ${other} exposed form is on the ${listing} page`,
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing);
});

Then('the {string} listing is present', async ({ page }, name: string) => {
  await waitForListing(page, listingOf(name));
});

Then('the line under the Groups title says {string}', async ({ page }, text: string) => {
  await expect(page.locator('#page-header-description')).toContainText(text);
  await expect(listingWrapper(page, 'Groups').getByText(text)).toHaveCount(0);
});

Then('the search toolbar is above its list', async ({ page }) => {
  const listing = requireListing();
  await expectToolbarAbove(page, CONTENT_ISLAND, `${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`);
  await expect(titleField(page, listing)).toBeVisible();
});

Then(
  'the {string} list has at least {int} row',
  async ({ page }, name: string, count: number) => {
    const listing = listingOf(name);
    const rows = listingRows(page, listing);
    await expect
      .poll(async () => await rows.count(), { timeout: 10000 })
      .toBeGreaterThanOrEqual(count);
  },
);

// A project row names the project only; its key stays searchable but unshown.
Then('no {string} row shows a project key', async ({ page }, name: string) => {
  const rows = listingRows(page, listingOf(name));
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.locator('[data-cell="key"]')).toHaveCount(0);
  await expect(rows.first().locator('[data-list-region="headline"] a')).toHaveCount(1);
});

Then('matching Alpha rows are visible and Beta rows are absent', async ({ page }) => {
  const listing = requireListing();
  const table = listingList(page, listing);
  await expect(table.getByText(LISTINGS[listing].alpha, { exact: true })).toBeVisible();
  await expect(table.getByText(LISTINGS[listing].beta, { exact: true })).toHaveCount(0);
});

Then('matching rows from the other workspace are absent', async ({ page }) => {
  const listing = requireListing();
  await expect(
    listingWrapper(page, listing).getByText(LISTINGS[listing].foreign, { exact: true }),
  ).toHaveCount(0);
});

Then('the empty result and the search field remain visible', async ({ page }) => {
  const listing = requireListing();
  const wrapper = listingWrapper(page, listing);
  await expect(wrapper.getByText(LISTINGS[listing].empty)).toBeVisible();
  await expect(titleField(page, listing)).toBeVisible();
});

Then('the original accessible rows return', async ({ page }) => {
  const listing = requireListing();
  const table = listingList(page, listing);
  await expect(table.getByText(LISTINGS[listing].alpha, { exact: true })).toBeVisible();
  await expect(table.getByText(LISTINGS[listing].beta, { exact: true })).toBeVisible();
  const rows = listingRows(page, listing);
  await expect
    .poll(async () => await rows.count(), { timeout: 10000 })
    .toBeGreaterThanOrEqual(baselineRowCount ?? 2);
});

Then('the search field still reads {string}', async ({ page }, value: string) => {
  await expect(titleField(page, requireListing())).toHaveValue(value);
});

Then('the listing is refused', async () => {
  expect(
    lastListingStatus,
    'A foreign-workspace listing must fail closed, not render the View',
  ).toBe(404);
});

Then(
  'the rail lists {string}, {string} and {string} before the {string} heading',
  async ({ page }, first: string, second: string, third: string, heading: string) => {
    const rail = page.locator(RAIL_ISLAND);
    const nodes = [
      rail.getByRole('link', { name: first, exact: true }),
      rail.getByRole('link', { name: second, exact: true }),
      rail.getByRole('link', { name: third, exact: true }),
      rail.getByText(heading, { exact: true }),
    ];
    const handles = [];
    for (const node of nodes) {
      await expect(node.first()).toBeAttached();
      handles.push(await node.first().elementHandle());
    }
    for (let i = 1; i < handles.length; i++) {
      const ordered = await handles[i - 1]!.evaluate(
        (a, b) => Boolean(a.compareDocumentPosition(b as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
        handles[i],
      );
      expect(ordered, `rail entry ${i} is out of order`).toBe(true);
    }
  },
);

// THE CONTENT FRAME. A full page load hands the content island pre-rendered
// markup, a rail click hands it a render array, and both must frame the
// listing the same way: the View's own canvas and zone, no form canvas around
// them, which would add a second of each. Create
// (`HX-Location`) lands through a full page load, which is why a frame lost
// there shows up after it.
let lastTableLeft: number | null = null;

async function tableLeft(page: Page): Promise<number> {
  const list = page.locator(`${CONTENT_ISLAND} [data-component-id="bb_theme:list"]`).first();
  await expect(list, 'The content island holds no listing list').toBeVisible({ timeout: 20000 });
  const box = await list.boundingBox();
  return box?.x ?? Number.NaN;
}

Then('the listing sits in a single content frame', async ({ page }) => {
  const island = page.locator(CONTENT_ISLAND);
  await expect(
    island.locator('[data-component-id="bb_theme:canvas"]'),
    'The listing is not framed by exactly one canvas',
  ).toHaveCount(1);
  await expect(
        island.locator('[data-component-id="bb_theme:zone"]'),
    'The listing is not framed by exactly one zone',
  ).toHaveCount(1);
  lastTableLeft = await tableLeft(page);
});

Then('the list edge has not moved since the last frame check', async ({ page }) => {
  if (lastTableLeft === null) {
    throw new Error('No frame check recorded a list edge yet.');
  }
  expect(await tableLeft(page), 'The listing list moved sideways').toBe(lastTableLeft);
});
