// Shared steps of the faceted list screens: signing in as a workspace member,
// picking facets and chips, reading the address, the closed-rows control.
// Consumers: features/tickets, runs, projects.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { php } from '../drush';
import { active, closedControl, facetRow, facetTrigger, listing, safe } from '../listing';

/**
 * Uses the recipe's ordinary reader for each workspace. Selecting the first
 * member depends on import order and can choose a login-only account without
 * project access. Membership and uid > 1 remain explicit tenancy preconditions.
 */
Given(
  'I am signed in as a member of the {string} workspace',
  async ({ page, authProvider }, slug: string) => {
    const actors: Record<string, string> = { bakers: 'north-lead', other: 'south-contributor' };
    const actor = actors[slug];
    if (!actor) {
      throw new Error(`No recipe reader is defined for the "${slug}" workspace.`);
    }
    const s = safe(slug);
    const uid = php(
      [
        '$etm = \\Drupal::entityTypeManager();',
        `$ws = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${s}"]));`,
        `$u = current($etm->getStorage("user")->loadByProperties(["name" => "${actor}"]));`,
        'if ($ws && $u && (int) $u->id() > 1 && \\Drupal::service("og.membership_manager")->isMember($ws, $u->id())) {',
        'print $u->id(); }',
      ].join(' '),
    );
    if (!uid || uid === '0') {
      throw new Error(`Recipe reader "${actor}" must be a member of the "${slug}" workspace.`);
    }
    listing.uid = uid;
    listing.slug = slug;
    await authProvider.login(page, uid);
  },
);

When('I reload the ticket list', async ({ page }) => {
  await active(page).reload();
});

/**
 * Picks one facet value the way a keyboard user does.
 *
 * BY LABEL, ASSERTED BY VALUE. The row is found by the text an operator reads
 * and the address is asserted on the machine value it submits, which is T11b's
 * split stated in the browser rather than in a Kernel test: the panel says
 * `High`, the URL says `1`.
 *
 * THE INPUT IS REACHED BY FOCUS RATHER THAN BY A POINTER, and the reason is a
 * measured defect and not a convenience. the canvas' `[data-canvas-region="filters"]` region is
 * `position: sticky`, which creates a stacking context, so the panel's
 * `z-index: 30` cannot escape it and the table's positioned `<td>` paints over
 * the rows: `document.elementFromPoint()` at the centre of a row returns that
 * `<td>`, and a raw click there picks nothing. Focus and Space is a genuine user
 * path and drives exactly the mechanism under test — auto-submit, the boost, the
 * pushed URL and the re-rendered chips.
 *
 * THE WAIT IS ON THE ADDRESS, which is the mechanism's own last act: htmx
 * pushes the request URL after the swap has landed. Waiting for a duration would
 * make the assertions true of a request that had not happened yet, and waiting
 * for a navigation event would time out on success, because a boosted
 * navigation fires none.
 */
When(
  'I choose {string} in the {string} facet',
  async ({ page }, label: string, facet: string) => {
    const target = active(page);
    const row = await facetRow(page, facet, label);
    const value = await row.getAttribute('data-value');

    const input = row.locator('input');
    await input.focus();
    await page.keyboard.press(' ');
    await expect(input).toBeChecked();

    await target.waitForFunction(
      (expected) => decodeURIComponent(window.location.search).includes(expected),
      `=${value}`,
      { timeout: 20000 },
    );
  },
);

/**
 * AC 5's first half: the filter set is IN the address.
 *
 * Read off `location.search` DECODED, because the assertion is about the
 * parameter Drupal reads — `state[]=working` — and the browser stores it as
 * `state%5B%5D=working`. Asserting the encoded form would make the step track
 * URLSearchParams' escaping rules instead of the query contract.
 */
Then('the address carries {string}', async ({ page }, parameter: string) => {
  const target = active(page);
  try {
    await target.waitForFunction(
      (expected) => decodeURIComponent(window.location.search).includes(expected),
      parameter,
      { timeout: 20000 },
    );
  } catch {
    // The wait only outruns the boosted swap; a genuine miss still has to
    // fail with the authored "The address is …" message.
  }
  const search = decodeURIComponent(new URL(target.url()).search);
  expect(search, `The address is "${search}"`).toContain(parameter);
});

/**
 * Removes one chip by clicking its dismiss link.
 *
 * IT IS STILL A LINK, AND THAT IS STILL THE WHOLE MECHANISM. `active-filters`
 * renders an anchor per chip whose href is the current address minus that
 * facet; the content island boosts anchors, so following it swaps the fragment
 * and pushes the shorter URL exactly as picking a facet does. Nothing posts and
 * no script of ours runs — which is why the assertions around this step are
 * "the document survived" and "the address does not carry".
 *
 * THE HREF IS NOW BUILT IN TWIG, from what `views_filters_summary` states, and
 * that is deliberate: the module's own dismiss link is
 * `Url::fromUserInput('/')` and its removal is a `location.reload()` driven by
 * unchecking the exposed control. Taking that would have made this scenario
 * assert the opposite of "the document survived". See
 * `bb_theme/templates/views-filters-summary.html.twig`.
 *
 * THE CLICK IS ON THE ANCHOR'S GLYPH, and the glyph is a CSS `::after` rather
 * than the component's sprite icon. That is the one cost of the module's seam:
 * its area returns the strip as a plain-string `#markup`, so
 * `Renderer::ensureMarkupIsSafe()` runs it through `Xss::filterAdmin()`, whose
 * tag list has no `svg` — the icon is deleted and the anchor arrives with no
 * content and therefore no box. `css/app.src.css` gives an anchor with no
 * element child a `×` through `::after`, which is what makes the anchor
 * clickable again; without it Playwright would time out on a zero-size
 * element rather than report the missing icon. The human accepted the module
 * with its mechanism on 2026-09-04.
 *
 * The chip is found by its FIELD NAME rather than by position, because the chip
 * order is the display's and a positional locator would silently start removing
 * a different filter the day a facet is reordered.
 */
When('I remove the {string} chip', async ({ page }, field: string) => {
  const target = active(page);
  // `active-filters` carries no BEM classes of its own — the chip is a bare
  // `<span>` and its dismiss control is an anchor named by its accessible
  // name, `Remove the {field} filter`, which is the one thing the template
  // guarantees. That accessible name is therefore the locator, for both the
  // presence check and the click. Disambiguated with `.first()`: two chips
  // can legitimately name the same field (e.g. a facet whose override label
  // repeats across values), and the accessible-name locator would otherwise
  // match more than one element and fail in Playwright's strict mode.
  const remove = target.getByRole('link', { name: `Remove the ${field} filter` }).first();
  await expect(remove, `The "${field}" chip carries no dismiss link`).toBeAttached();

  // Waited on as a CHANGE rather than against the href, and the difference is
  // not fussiness. The href is percent-encoded (`priority%5B%5D=2`) and what
  // htmx pushes is whatever the browser normalises the request URL to, so an
  // equality check here would be asserting an escaping rule instead of the
  // removal. That the address moved at all is the observable; which address it
  // moved to is what the `Then` steps after this one are for.
  const before = await target.evaluate(() => window.location.pathname + window.location.search);
  await remove.click();
  await target.waitForFunction(
    (previous) => window.location.pathname + window.location.search !== previous,
    before,
    { timeout: 20000 },
  );
});

/**
 * The negative half of `the address carries`, and it needs its own step.
 *
 * A removal is only observable as an ABSENCE, and asserting the presence of
 * what is left would pass against a link that removed nothing as long as some
 * other filter survived.
 */
/**
 * Polled rather than read once. Un-picking a value is a click that does not
 * wait for the address (the next Then may need the pre-swap row), so the
 * swap that actually removes the parameter can still be in flight when this
 * step runs. A timeout must still fail with the authored "The address is …"
 * message rather than a waitForFunction error, so the wait is wrapped and
 * the assertion below is what reports.
 */
Then('the address does not carry {string}', async ({ page }, parameter: string) => {
  const target = active(page);
  try {
    await target.waitForFunction(
      (needle) => !decodeURIComponent(window.location.search).includes(needle),
      parameter,
      { timeout: 20000 },
    );
  } catch {
    // Fall through to the assertion so a genuine miss keeps its diagnostic.
  }
  const search = decodeURIComponent(new URL(target.url()).search);
  expect(search, `The address is "${search}"`).not.toContain(parameter);
});

Then(
  'the {string} facet shows {string} as chosen',
  async ({ page }, facet: string, label: string) => {
    const target = active(page);
    const trigger = facetTrigger(target, facet);
    // The trigger is what an operator sees with the panel shut, so the claim is
    // read there and not only off the control the panel hides.
    await expect(trigger).toContainText(label);
    const panelId = await trigger.getAttribute('aria-controls');
    const row = target
      .locator(`#${panelId} li[data-value]`)
      .filter({ has: target.locator('.option-list__label', { hasText: label }) })
      .first();
    await expect(row.locator('input')).toBeChecked();
  },
);

/**
 * Opens the current address in a second tab of the SAME context.
 *
 * That is what sharing a URL is: the address alone carries the filter set, with
 * nothing remembered anywhere. A second CONTEXT would lose the session and turn
 * this into a login test; a reload of the same tab would not leave the tab that
 * produced the state.
 */
When('I open the current address in a fresh tab', async ({ page }) => {
  const address = active(page).url();
  listing.page = await page.context().newPage();
  await listing.page.goto(address);
});

/**
 * Picks one of the three closed positions by following its link.
 *
 * A REAL LINK, so this is a plain click and not a keyboard interaction — the
 * control's own twig states it works with JavaScript off, and the assertion
 * that follows (`toHaveAttribute`) auto-retries across whatever the click
 * turns out to be: a boosted swap of `#island-content` or, if a boost
 * declaration is lost on the second pick, a full page load.
 */
When('I choose the {string} closed position', async ({ page }, label: string) => {
  const target = active(page);
  const control = closedControl(target);
  await expect(control, 'No closed-rows control on this screen').toBeAttached();
  const link = control.getByRole('link', { name: label, exact: true });
  await expect(link, `The closed control offers no "${label}" position`).toBeAttached();
  await link.click();
  await expect(
    closedControl(target).getByRole('link', { name: label, exact: true }),
    `Choosing "${label}" did not mark it the current position`,
  ).toHaveAttribute('aria-current', 'page');
});

/**
 * Asserts `aria-current="page"` on exactly one of the control's three links.
 *
 * ON THE ATTRIBUTE, NOT A CSS CLASS: the class is styling and can be renamed
 * without changing what the component promises, while `aria-current` is the
 * contract `segmented_control.component.yml` states.
 */
Then('the closed control marks {string} as the current position', async ({ page }, label: string) => {
  const target = active(page);
  const control = closedControl(target);
  await expect(control, 'No closed-rows control on this screen').toBeAttached();
  for (const candidate of ['Open', 'Closed', 'All']) {
    const link = control.getByRole('link', { name: candidate, exact: true });
    await expect(link, `The closed control offers no "${candidate}" position`).toBeAttached();
    if (candidate === label) {
      await expect(link, `"${candidate}" is not marked as the current position`)
        .toHaveAttribute('aria-current', 'page');
    }
    else {
      await expect(link, `"${candidate}" is unexpectedly marked as the current position`)
        .not.toHaveAttribute('aria-current', 'page');
    }
  }
});
