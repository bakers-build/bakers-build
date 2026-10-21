import { test, expect } from '@playwright/test';

// BB-398 D2 + D3. linkToPage() replaces the CONTENTS of a container the PAGE
// owns. The harness theme's page.html.twig writes that container around the
// main-content region and nothing else — and HtmxRenderer renders
// `<body>{{ content }}</body>` without ever running a page template, so
// `#page-content` exists in the document and never in the response fragment.
//
// That asymmetry is the whole reason this builder writes no hx-select: there is
// nothing in the fragment to select, and nothing needs selecting, because the
// fragment already IS the main content. It is measured here rather than
// inferred from the renderer's source.
//
// The surviving-container assertion is the load-bearing one. innerHTML versus
// outerHTML is otherwise invisible, and a container that survives every swap is
// the structural guarantee the whole reversal was for: it can never be removed
// from the document, so a later link on the page can never become a dead click.

test('a page-container link swaps the container contents and leaves the container itself', async ({ page }) => {
  await page.goto('/island-example/page-link');
  await expect(page.locator('[data-testid="page-link"]')).toBeVisible();

  // The fragment this click will fetch carries no container of its own.
  const fragment = await page.request.get(
    '/island-example/page-link-target?_wrapper_format=drupal_htmx',
  );
  expect(fragment.ok()).toBeTruthy();
  expect(await fragment.text()).not.toContain('page-content');

  // Mark the live container node and the window. A swap that replaced the
  // container would lose the mark; a document reload would lose both.
  await page.locator('#page-content').evaluate((element) => {
    (element as HTMLElement).dataset.marked = 'yes';
  });
  await page.evaluate(() => ((window as any).__noReload = 'alive'));

  const fragmentRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('_wrapper_format=drupal_htmx')) {
      fragmentRequests.push(request.url());
    }
  });

  await page.locator('[data-testid="page-link"]').click();

  // Wait for the swap to land BEFORE asserting anything about the container.
  // click() returns when the click is dispatched, not when htmx has finished
  // swapping, so a survival assertion made first passes against the pre-swap
  // document — measured: with the swap mutated to outerHTML it passed anyway,
  // and only this ordering makes it fail.
  await expect(page.locator('[data-testid="page-link-arrived"]')).toHaveText('Arrived');

  // The container is the SAME node: innerHTML replaced its contents, not it.
  await expect(page.locator('#page-content')).toHaveAttribute('data-marked', 'yes');
  // ...and what arrived is inside it...
  await expect(page.locator('#page-content [data-testid="page-link-arrived"]')).toBeVisible();
  // ...the document never reloaded...
  expect(await page.evaluate(() => (window as any).__noReload)).toBe('alive');
  // ...and it cost exactly one request.
  expect(fragmentRequests).toHaveLength(1);
});
