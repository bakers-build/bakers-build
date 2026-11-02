import { When, Then } from '../../bdd.fixtures';
import { expect, type Page, type Request } from '@playwright/test';
import { markDocument } from '../../support/shell';

// The shell places content/footer inside its main column; each slot remains the
// direct parent of its placement after the dialog layout change. BB-503
// removed the header region entirely, so there are three placed regions rather
// than four and `.shell__header` no longer exists to select.
//
// The content and footer regions render as `<main>`/`<footer>` respectively
// (see `shell.twig`), so those two are addressed by tag. Task 9/10's rebuild
// (BB-504) deleted every BEM class from `shell.twig`, including
// `.shell__sidebar` — the sidebar wrapper is now a bare, unmarked `<div
// class="shrink-0">` with no semantic tag or `data-component-id` of its own.
// It is still structurally distinguishable, though: it is the only element
// directly under the shell root whose OWN direct child is the placed island —
// the main-column wrapper also sits directly under the root, but the island
// sits inside ITS `<main>`/`<footer>` child, one level deeper.
const shellPlacements = [
  '[data-component-id="bb_theme:shell"] > div > [id^="island-profile_"]',
  '[id$="-shell_page_header"]',
  '[id$="-shell_content_island"]',
  '[data-component-id="bb_theme:shell"] footer > [id^="island-profile_"]',
].join(', ');
const SHELL_PLACEMENT_COUNT = 4;

// Per-slot selector used to re-check a single replaced region below. Keyed by
// the same slot name the `slot` derivation below now reads off the parent's
// tag (`main`/`footer`) or, for the unmarked sidebar wrapper, off elimination.
const shellSlotSelector: Record<string, string> = {
  sidebar: '[data-component-id="bb_theme:shell"] > div:has(> [id^="island-profile_"])',
  header: '[id$="-shell_page_header"]',
  content: '[id$="-shell_content_island"]',
  footer: '[data-component-id="bb_theme:shell"] footer',
};
const navigationRequests = new WeakMap<Page, { types: string[]; listener: (request: Request) => void }>();

When('I open the workspace chooser route', async ({ page }) => {
  // The existing landing suite separately covers the site's '/' alias.
  await page.goto('/home');
  await markDocument(page);
});

When('I remember the shell placements', async ({ page }) => {
  await expect(page.locator(shellPlacements)).toHaveCount(SHELL_PLACEMENT_COUNT);
  await markDocument(page);
  await page.locator(shellPlacements).evaluateAll((nodes) => {
    (window as unknown as Record<string, unknown>).__bakers423_shell = nodes.map((node) => ({
      id: node.id,
      // No BEM class survives on any of the three wrappers now, so the slot is
      // read off the parent's tag instead — and, for the sidebar, off the
      // absence of one: it is the only unmarked `<div>` among the three.
      slot: (() => {
        const id = node.id || '';
        if (id.endsWith('-shell_page_header')) return 'header';
        if (id.endsWith('-shell_content_island')) return 'content';
        const tag = node.parentElement!.tagName;
        if (tag === 'MAIN') return 'content';
        if (tag === 'FOOTER') return 'footer';
        return 'sidebar';
      })(),
      node,
    }));
  });
  const types: string[] = [];
  const listener = (request: Request) => {
    if (['document', 'xhr', 'fetch'].includes(request.resourceType())) types.push(request.resourceType());
  };
  navigationRequests.set(page, { types, listener });
  page.on('request', listener);
});

Then('exactly the shell placements {string} were replaced in one request', async ({ page }, expected: string) => {
  const expectedReplaced = expected.split(',').sort();
  await expect.poll(() => page.evaluate(() => {
    const nodes = (window as unknown as Record<string, unknown>).__bakers423_shell as { id: string; slot: string; node: Element }[];
    if (!nodes) throw new Error('Remember the shell before checking replacements.');
    return nodes.filter(({ id, node }) => document.getElementById(id) !== node)
      .map(({ slot }) => slot).sort();
  })).toEqual(expectedReplaced);
  // Exact equality above also asserts that the footer retained node identity;
  // count and attachment distinguish replacement from accidental removal.
  await expect(page.locator(shellPlacements)).toHaveCount(SHELL_PLACEMENT_COUNT);
  for (const id of expectedReplaced) {
    const selector = shellSlotSelector[id];
    if (id === 'header' || id === 'content') {
      await expect(page.locator(selector)).toHaveCount(1);
      continue;
    }
    await expect(page.locator(`${selector} > [id^="island-profile_"]`)).toHaveCount(1);
  }
  const requests = navigationRequests.get(page);
  if (!requests) throw new Error('Remember the shell before counting its requests.');
  page.off('request', requests.listener);
  expect(requests.types).toEqual(['xhr']);
});

Then('the gate chrome is absent', async ({ page }) => {
  await expect(page.locator('.gate')).toHaveCount(0);
});

// The `browser_conditional` recipe profile covers both pages; its menu
// placement passes a route_name condition on the first page only.
const conditionalPlacement = '[data-component-id="bb_theme:shell"] [id^="island-profile_"][id$="-conditional"]';

When('I open the conditional placement page {string}', async ({ page }, name: string) => {
  await page.goto(`/island-browser/conditional/${name}`);
  await expect(page.locator('[data-component-id="bb_theme:shell"] [id^="island-profile_"][id$="-content"]')).toHaveCount(1);
});

Then('the conditional placement is {word}', async ({ page }, visibility: string) => {
  if (!['shown', 'hidden'].includes(visibility)) throw new Error(`Expected shown or hidden, got ${visibility}`);
  await expect(page.locator(conditionalPlacement)).toHaveCount(visibility === 'shown' ? 1 : 0);
});
