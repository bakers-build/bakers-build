import { test, expect } from '@playwright/test';

// BB-398 D11 / AC 9. No head-support extension and no title JS: HtmxRenderer
// emits the route's title into the fragment response, and htmx lifts a full
// document's <title> into document.title after the swap. The one thing that
// breaks it from this side is `ignoreTitle` in a swap spec — which core's
// Htmx::swap() adds BY DEFAULT. Both demo navigations are checked here, and
// both are written by IslandPluginBase::linkToRoute() since the link layer was
// withdrawn; linkToPage()'s half of the same condition is held by
// IslandPageLinkTest::testThePageLinkNeverIgnoresTheTitle().
//
// A measured asymmetry the patterns below allow for, rather than hide: a FULL
// page load renders html.html.twig's `head_title`, which is "<route title> |
// <site name>", while HtmxRenderer's fragment template emits `{{ title }}` —
// the bare route title, with no site name. So after a swap the document title
// is "Notes", not "Notes | Island E2E". The title follows the route either
// way, which is what AC 9 asks; the suffix is core's to add and core does not.
// `\b` is what keeps "Task" from matching "Tasks", which is the whole point of
// the second test.

test('the document title follows the route across a rail link the island authors', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await expect(page).toHaveTitle(/^Tasks\b/);

  // Written by ChromeIsland through IslandPluginBase::linkToRoute(), aimed at
  // a peer container rather than at the island's own id — the other target
  // shape of the same builder from the one the second test exercises.
  await page.locator('[data-testid="rail-Notes"]').click();
  await expect(page.locator('#island-tasks-note')).toBeVisible();

  await expect(page).toHaveTitle(/^Notes\b/);
});

test('the document title follows the route across an island-authored link', async ({ page }) => {
  await page.goto('/island-example/tasks');
  await expect(page).toHaveTitle(/^Tasks\b/);

  // Built by IslandPluginBase::linkToRoute() against the island's own target.
  // It pushes the URL, so the address bar now names the detail route; a title
  // still reading "Tasks" would contradict it.
  await page.locator('[data-task-id] [data-testid="open-task"]').first().click();
  await expect(page.locator('#island-tasks-task_detail')).toBeVisible();

  await expect(page).toHaveTitle(/^Task\b/);
});
