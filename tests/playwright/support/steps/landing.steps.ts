// Shared site-root and gate steps: the landing's chooser, the address after
// the redirect chain, and the gate chrome that replaces the shell.
// Consumers: features/home, island-profiles, sign-in.
// The site root's three answers, measured in a browser (BB-415).
//
// WHY THIS IS A BROWSER SUITE AND NOT A PHP ONE. Acceptance criteria 1 and 2
// are about the ADDRESS the operator ends up at — that it names the workspace,
// that it is bookmarkable, that it is not `/`. A kernel test can assert the
// `Location` header of one 302; only a browser follows the chain the way an
// operator does, through `PathProcessorFront`, the redirect, and the outbound
// path processor that strips `/_workspace`. Criterion 5's chooser has the
// second reason: its workspace list is an ARRAY PROP, and the only honest
// assertion about an array prop is against the rendered DOM (spec R4).
import { When, Then } from '../../bdd.fixtures';
import { expect } from '@playwright/test';
import { markDocument } from '../shell';

/**
 * The landing body marker, and its value says WHICH answer was rendered.
 *
 * `BbHomeController::BODY_ATTRIBUTE`. The value matters: `chooser` and
 * `empty` are the pair a defect swaps for one another, and a bare presence
 * check cannot tell them apart — an operator shown "you are in no workspace"
 * on a site where they hold two would look exactly like a working screen.
 */
const HOME_BODY = '[data-bakers-home-body]';

/** The `gate` chrome's root, the peer of `shell` (spec D6). */
const GATE = '.gate';

/** The application shell's root, which a gate page must NOT carry. */
const SHELL = '[data-component-id="bb_theme:shell"]';

/**
 * Opens the site root and stamps the document.
 *
 * The mark is taken HERE rather than in a later step because the two-click
 * scenario has to know whether the document survived the clicks, and identity
 * can only be recorded before the first one. `waitUntil: 'load'` rather than
 * the default so the 302 chain has finished before anything is asserted.
 */
When('I open the site root', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await markDocument(page);
});

/**
 * Clicks a chooser row by its target.
 *
 * By href and not by label: the label is the workspace's NAME, which the seed
 * may rename, while the target is the property the criterion is about.
 */
When('I choose the workspace {string}', async ({ page }, target: string) => {
  await page.locator(`${HOME_BODY} a[href="${target}"]`).first().click();
  await page.waitForURL(`**${target}`);
});

/**
 * The address, path only.
 *
 * The query string and the fragment are deliberately dropped: what the criteria
 * name is the path that identifies the workspace, and a facet default appended
 * by the ticket list is not part of it.
 */
Then('the address is {string}', async ({ page }, expected: string) => {
  expect(new URL(page.url()).pathname).toBe(expected);
});

Then('the workspace chooser is present', async ({ page }) => {
  await expect(page.locator(HOME_BODY)).toHaveAttribute(
    'data-bakers-home-body',
    'chooser',
  );
});

/**
 * A chooser row really points at that workspace's public My work address.
 *
 * The href is what makes criterion 2 true for the chooser branch as well as for
 * the redirect one: `/_workspace/other/tickets` would render identically here
 * and be unfollowable, because `_workspace` is never a public segment.
 */
Then('the workspace chooser offers {string}', async ({ page }, target: string) => {
  await expect(
    page.locator(`${HOME_BODY} a[href="${target}"]`).first(),
  ).toBeVisible();
});

Then('the gate chrome is present', async ({ page }) => {
  await expect(page.locator(GATE).first()).toBeVisible();
});

/** The gate's top bar: the product mark and one quiet link out. */
Then('the gate top bar links {string} to {string}', async ({ page }, label: string, href: string) => {
  await expect(
    page.locator(`${GATE} header`).getByRole('link', { name: label, exact: true }),
  ).toHaveAttribute('href', href);
});

/** A gate offers the one thing the page is for, plus the single top-bar link. */
Then('the gate offers no other navigation', async ({ page }) => {
  const gate = page.locator(GATE).first();
  await expect(gate.getByRole('navigation')).toHaveCount(0);
  await expect(gate.locator('header a')).toHaveCount(1);
});

Then('the page has exactly one h1', async ({ page }) => {
  await expect(page.locator('h1')).toHaveCount(1);
});

/**
 * The gate card pads its content itself, so a form sits directly in it.
 *
 * A canvas and zone around the form would nest a second and third padding
 * inside the card's own, shrinking the form to a narrow column.
 */
Then('the gate card holds the form without a frame of its own', async ({ page }) => {
  const gate = page.locator(GATE).first();
  await expect(gate.locator('[data-component-id="bb_theme:canvas"]')).toHaveCount(0);
  await expect(gate.locator('[data-component-id="bb_theme:zone"]')).toHaveCount(0);
  const content = await gate.locator('.gate__content').boundingBox();
  const form = await gate.locator('form').first().boundingBox();
  expect(form?.width, 'The form does not fill the gate card').toBe(content?.width);
});

/**
 * The gate is NOT the shell, asserted as absence.
 *
 * Spec D6's whole argument: the rail is workspace-ambient and
 * its workspace links (`WorkspaceMenuLink`) are denied on a route that
 * carries no workspace, so a shell here would render a navigation with no
 * reachable entry. A page-layout condition that widened to match `/home` would
 * produce exactly that, and it would look like a working page.
 */
Then('the application shell is not present', async ({ page }) => {
  await expect(page.locator(SHELL)).toHaveCount(0);
});

/**
 * Switches the page to the cozy layout density, as `js/skin.src.js` does from
 * the persisted choice: the `data-layout` attribute on `<html>`.
 */
When('the layout density is cozy', async ({ page }) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-layout', 'cozy'));
});

/**
 * The create action stands once, apart from the list or empty state above it.
 *
 * Measured as the vertical distance between the action's top edge and the
 * bottom edge of the body element before it, with 1px for subpixel rounding.
 */
Then(
  'the create action stands {int} pixels below the content above it',
  async ({ page }, expected: number) => {
    const body = page.locator(HOME_BODY);
    const create = body.getByRole('link', { name: 'Create a new workspace', exact: true });
    await expect(create).toHaveCount(1);
    const gap = await create.evaluate(link => {
      let cell: Element = link;
      while (!cell.previousElementSibling && cell.parentElement) cell = cell.parentElement;
      const previous = cell.previousElementSibling;
      if (!previous) return Number.NaN;
      return link.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
    });
    expect(Math.abs(gap - expected), `the gap is ${gap}px`).toBeLessThanOrEqual(1);
  },
);
