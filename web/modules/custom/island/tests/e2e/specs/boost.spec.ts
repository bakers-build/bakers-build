import { test, expect, Page } from '@playwright/test';

// BB-408 — the client-declared update path, in a real browser.
//
// This is the only surface that can observe acceptance criteria 2, 3 and 10.
// Neither standing web-UI gate can see any of them: a kernel test can prove
// what the server answers to a set of headers, but not that htmx sends those
// headers, not how many HTTP requests one click costs, and not that the same
// anchor still works with JavaScript switched off.
//
// The fixture is island_example. Its rail and its content region are islands
// with a client declaration on each container; the anchors inside them carry
// nothing at all.

/** Every hx-* / data-hx-* attribute on one element. */
async function htmxAttributes(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((element) =>
    Array.from(element.attributes)
      .map((attribute) => attribute.name)
      .filter((name) => name.startsWith('hx-') || name.startsWith('data-hx-')),
  );
}

test('a rail click costs one request and renders two islands', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await expect(page.locator('[data-testid="demo-rail-active"]')).toHaveText('Tasks');

  // A marker that survives a swap and dies on a document load. The request
  // count alone cannot tell the two apart: a full page load also issues
  // exactly one request for /island-example/notes, so counting to one would
  // pass against the very failure this test is named for. The marker is what
  // makes "one request" mean "one swap".
  await page.evaluate(() => ((window as never as { __alive: string }).__alive = 'yes'));

  // Every request the click causes, of any kind. Counting only XHR would hide
  // the failure this guards against — a boost that fell back to a full page
  // load looks identical from the outside otherwise.
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));

  await page.locator('[data-testid="rail-boost-Notes"]').click();

  // The content region became the notes island...
  await expect(page.locator('#island-tasks-note')).toBeVisible();
  // ...and the rail came along in the SAME response, with its active entry
  // recomputed from the route being served. That is the whole point: the nav
  // is right afterwards without the nav being re-rendered on every navigation.
  await expect(page.locator('[data-testid="demo-rail-active"]')).toHaveText('Notes');

  // The document was never replaced, so this was a swap and not a navigation.
  expect(await page.evaluate(() => (window as never as { __alive: string }).__alive)).toBe('yes');

  const navigations = requests.filter((request) => request.includes('/island-example/notes'));
  expect(navigations).toHaveLength(1);
});

test('a boosted navigation is repeatable: the second click swaps too', async ({ page }) => {
  // The regression this exists for. The declaration used to be applied by the
  // CALLER — the controller for a page build — so a swapped container came
  // back bare and the boosted session ended after exactly one click. Nothing
  // in the suite clicked twice, so nothing caught it. Measured with a
  // throwaway probe: the rail's five hx-* attributes before the click, none
  // after it.
  await page.goto('/island-example/tasks');

  const railBefore = await htmxAttributes(page, '#island-tasks-chrome');
  const contentBefore = await htmxAttributes(page, '#island-tasks-content');
  expect(railBefore.length).toBeGreaterThan(0);
  expect(contentBefore.length).toBeGreaterThan(0);

  // Click one — the rail. The rail rides along out of band and the content
  // region arrives as the main fragment, so BOTH containers in the document
  // are now server-rendered fragments rather than page build output.
  await page.locator('[data-testid="rail-boost-Notes"]').click();
  await expect(page.locator('#island-tasks-note')).toBeVisible();
  await expect(page.locator('[data-testid="demo-rail-active"]')).toHaveText('Notes');

  expect(await htmxAttributes(page, '#island-tasks-chrome')).toEqual(railBefore);
  expect(await htmxAttributes(page, '#island-tasks-content')).toEqual(contentBefore);

  // A marker that survives a swap and dies on a document load. Set AFTER the
  // first click, so the two clicks below are each tested against it.
  await page.evaluate(() => ((window as never as { __alive: string }).__alive = 'yes'));

  // Click two, inside the SWAPPED content island: one request, no reload.
  const contentRequests: string[] = [];
  const countContent = (request: { method(): string; url(): string }) =>
    contentRequests.push(`${request.method()} ${request.url()}`);
  page.on('request', countContent);
  await page.locator('[data-testid="content-boost-tasks"]').click();
  await expect(page.locator('#island-tasks-task_list')).toBeVisible();
  page.off('request', countContent);

  expect(await page.evaluate(() => (window as never as { __alive: string }).__alive)).toBe('yes');
  expect(contentRequests.filter((request) => request.includes('/island-example/tasks'))).toHaveLength(1);

  // Click three, inside the SWAPPED rail: the out-of-band peer's own
  // declaration, which is the half a surviving-wrapper fix could never reach.
  const railRequests: string[] = [];
  const countRail = (request: { method(): string; url(): string }) =>
    railRequests.push(`${request.method()} ${request.url()}`);
  page.on('request', countRail);
  await page.locator('[data-testid="rail-boost-Notes"]').click();
  await expect(page.locator('#island-tasks-note')).toBeVisible();
  page.off('request', countRail);

  expect(await page.evaluate(() => (window as never as { __alive: string }).__alive)).toBe('yes');
  expect(railRequests.filter((request) => request.includes('/island-example/notes'))).toHaveLength(1);
  await expect(page.locator('[data-testid="demo-rail-active"]')).toHaveText('Notes');
});

test('a content click renders one island and leaves the chrome standing', async ({ page }) => {
  await page.goto('/island-example/notes');
  await expect(page.locator('#island-tasks-note')).toBeVisible();

  await page.evaluate(() => ((window as never as { __alive: string }).__alive = 'yes'));
  const chrome = await page.locator('[data-testid="chrome"]').innerHTML();
  const rail = await page.locator('#island-tasks-chrome').innerHTML();

  await page.locator('[data-testid="content-boost-tasks"]').click();
  await expect(page.locator('#island-tasks-task_list')).toBeVisible();

  // No document reload, and the static chrome is untouched.
  expect(await page.evaluate(() => (window as never as { __alive: string }).__alive)).toBe('yes');
  expect(await page.locator('[data-testid="chrome"]').innerHTML()).toBe(chrome);

  // The rail is byte-identical, which is what "one island" means here — the
  // content island targets ITSELF and therefore declares nothing out of band.
  //
  // It also means the rail's active entry still reads "Notes" while the
  // content is the task list. That is the accepted stale-nav miss (D9), chosen
  // by the human on 2026-08-29 over giving every link builder a parameter, and
  // it is asserted rather than merely documented so that it stays a decision
  // instead of drifting into a surprise.
  expect(await page.locator('#island-tasks-chrome').innerHTML()).toBe(rail);
  await expect(page.locator('[data-testid="demo-rail-active"]')).toHaveText('Notes');
});

test('a swapped island is not nested inside its own wrapper', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await page.locator('[data-testid="rail-boost-Notes"]').click();
  await expect(page.locator('#island-tasks-note')).toBeVisible();

  // outerHTML, not innerHTML. A boosted element defaults to innerHTML
  // unconditionally in htmx, so getting this wrong puts a second copy of the
  // container inside the first on every single navigation.
  await expect(page.locator('#island-tasks-content')).toHaveCount(1);
  await expect(page.locator('#island-tasks-content #island-tasks-content')).toHaveCount(0);
  await expect(page.locator('#island-tasks-chrome')).toHaveCount(1);
  await expect(page.locator('#island-tasks-chrome #island-tasks-chrome')).toHaveCount(0);
});

test('the container carries the declaration and no link is touched', async ({ page }) => {
  await page.goto('/island-example/tasks');

  // The container.
  await expect(page.locator('#island-tasks-chrome')).toHaveAttribute('data-hx-boost', 'true');
  await expect(page.locator('#island-tasks-chrome')).toHaveAttribute('data-hx-target', '#island-tasks-content');
  await expect(page.locator('#island-tasks-chrome')).toHaveAttribute('data-hx-swap', 'outerHTML');
  await expect(page.locator('#island-tasks-chrome')).toHaveAttribute('data-hx-select-oob', '#island-tasks-chrome');

  // The boosted links inside it.
  expect(await htmxAttributes(page, '[data-testid="rail-boost-Notes"]')).toEqual([]);
  expect(await htmxAttributes(page, '[data-testid="content-boost-tasks"]')).toEqual([]);
});

test('an external link and a # anchor are not intercepted', async ({ page }) => {
  await page.goto('/island-example/tasks');

  // Neither carries an htmx attribute, because nothing writes one on a link.
  expect(await htmxAttributes(page, '[data-testid="content-external"]')).toEqual([]);
  expect(await htmxAttributes(page, '[data-testid="content-anchor"]')).toEqual([]);

  // htmx's own isLocalLink() refuses both before any decision of ours: it
  // requires the same hostname and an href that does not begin with '#'. The
  // observable consequence is that clicking the anchor issues no request at
  // all — it is an in-page jump, exactly as it would be without htmx.
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('[data-testid="content-anchor"]').click();
  await page.waitForTimeout(300);
  expect(requests).toHaveLength(0);
  expect(page.url()).toContain('#island-tasks-content');

  // The external link is a real navigation, not a fetch. Aborted so the suite
  // never reaches the network.
  await page.route('**://example.com/**', (route) => route.abort());
  const external = page.waitForRequest(
    (request) => request.url().startsWith('https://example.com/'),
  );
  await page.locator('[data-testid="content-external"]').click();
  expect((await external).resourceType()).toBe('document');
});

test('the same anchor still works by href: direct visit, middle click, no JavaScript', async ({
  page,
  context,
  browser,
}) => {
  // Direct visit.
  await page.goto('/island-example/notes');
  await expect(page.locator('#island-tasks-note')).toBeVisible();
  await expect(page.locator('[data-testid="chrome"]')).toBeVisible();

  // Middle click: a new tab with the whole page, chrome included.
  await page.goto('/island-example/tasks');
  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('[data-testid="rail-boost-Notes"]').click({ button: 'middle' }),
  ]);
  await opened.waitForURL('**/island-example/notes');
  await expect(opened.locator('#island-tasks-note')).toBeVisible();
  await expect(opened.locator('[data-testid="chrome"]')).toBeVisible();
  await opened.close();

  // No JavaScript: htmx never loads, the anchor is an anchor.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const plainPage = await plain.newPage();
  await plainPage.goto(`${page.url().split('/island-example')[0]}/island-example/tasks`);
  await plainPage.locator('[data-testid="rail-boost-Notes"]').click();
  await plainPage.waitForURL('**/island-example/notes');
  await expect(plainPage.locator('#island-tasks-note')).toBeVisible();
  await expect(plainPage.locator('[data-testid="chrome"]')).toBeVisible();
  await plain.close();
});

test('scrollIntoViewOnBoost is off, declared once, through a meta element', async ({ page }) => {
  await page.goto('/island-example/tasks');

  const metas = page.locator('meta[name="htmx-config"]');
  await expect(metas).toHaveCount(1);
  expect(await metas.getAttribute('content')).toContain('"scrollIntoViewOnBoost":false');

  // And htmx actually read it — this is the assertion that would still fail if
  // the meta were emitted after htmx initialised.
  const configured = await page.evaluate(
    () => (window as never as { htmx: { config: { scrollIntoViewOnBoost: boolean } } }).htmx.config.scrollIntoViewOnBoost,
  );
  expect(configured).toBe(false);
});

test('a boosted request neither reads nor poisons the internal page cache', async ({
  browser,
  request,
  baseURL,
}) => {
  const url = `${baseURL}/island-example/cacheable`;

  // 0. The boosted answer works on this route at all, against a COLD cache.
  //    Without this the test cannot tell "the policy failed" from "the
  //    subscriber never fired", and those need different fixes.
  const cold = await request.get(url, {
    headers: {
      'HX-Request': 'true',
      'HX-Boosted': 'true',
      'HX-Target': 'island-tasks-cacheable',
    },
  });
  expect(
    `${await cold.text()}\n--- X-Drupal-Cache: ${cold.headers()['x-drupal-cache'] ?? '(none)'}`,
  ).not.toContain('data-testid="cacheable-page"');

  // 1. A plain anonymous visit. This is what puts the WHOLE page into the
  //    internal page cache; every other demo route is marked no_cache and
  //    therefore cannot show this at all.
  const first = await request.get(url);
  expect(await first.text()).toContain('data-testid="cacheable-page"');

  // 2. A boosted request against the very same url. If the page-cache request
  //    policy were missing, the middleware would answer this from the entry
  //    above BEFORE the kernel runs — the subscriber would never fire and htmx
  //    would swap an entire HTML document into the island.
  const boosted = await request.get(url, {
    headers: {
      'HX-Request': 'true',
      'HX-Boosted': 'true',
      'HX-Target': 'island-tasks-cacheable',
    },
  });
  const fragment = `${await boosted.text()}\n--- X-Drupal-Cache: ${boosted.headers()['x-drupal-cache'] ?? '(none)'}`;
  expect(fragment).toContain('data-testid="cacheable-island"');
  expect(fragment).not.toContain('data-testid="cacheable-page"');
  expect(fragment).not.toContain('<html');

  // 3. And the boosted response was not written back over the page's own entry.
  //    Without the policy the next plain visitor is served the fragment as the
  //    whole document. setMaxAge(0) does not prevent this: the page cache
  //    ignores max age and stores any cacheable response.
  const third = await request.get(url);
  expect(await third.text()).toContain('data-testid="cacheable-page"');

  // A real browser, on a cold context, reaches the same page.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(url);
  await expect(freshPage.locator('[data-testid="cacheable-page"]')).toBeVisible();
  await fresh.close();
});
