// The shell's island detectors and account handles, shared by every feature
// whose steps observe the shell: the document mark that tells a boosted swap
// from a full load, the island selectors, and seed-account lookups.
import { Drush } from '@key-tec/playwright-core';
import type { Page } from '@playwright/test';

/** The shell heading island (title, tabs, create actions). */
export const PAGE_HEADER_ISLAND = '[id$="-shell_page_header"]';

/** The shell's content placement, scoped independently of its encoded host ID. */
export const CONTENT_ISLAND = '[id$="-shell_content_island"]';

/**
 * The shell's rail placement, observed as a direct child of the sidebar.
 *
 * Task 9/10's rebuild (BB-504) deleted `.shell__sidebar` along with every
 * other BEM class in `shell.twig`; the sidebar wrapper is now a bare, unmarked
 * `<div class="shrink-0">`. It stays reachable as the only element directly
 * under the shell root whose own direct child is the placed island — the
 * main-column wrapper is also a direct child of the root, but its island sits
 * one level deeper, inside `<main>`.
 */
export const RAIL_ISLAND = '[data-sidebar]';

/**
 * Stamp the window so a full page load can be detected.
 *
 * A boosted navigation replaces a fragment and keeps the document; a full load
 * discards it. There is no Playwright API for "was this the same document", so
 * the document itself is marked and the mark's survival is the answer. This is
 * the only reliable form: comparing URLs, request counts or navigation events
 * all report the same thing for both cases.
 */
// Exported so a second surface's steps use the SAME detector rather than a
// second one of their own (BB-414 Task 9). Two marks would be two ways for
// "the document was not reloaded" to mean two different things, and the step
// that reads the mark is registered exactly once, here.
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate((railId) => {
    (window as unknown as Record<string, unknown>).__bakers396_mark = 'kept';
    // The rail node is stamped in the same pass. Spec D3's negative — the rail
    // does not ride along — cannot be asserted by presence, because a
    // re-rendered rail is present too. Only node IDENTITY tells the two apart,
    // and identity has to be recorded before the click that might replace it.
    const rail = document.querySelector(railId);
    if (rail) {
      (rail as unknown as Record<string, unknown>).__bakers396_rail = true;
    }
  }, RAIL_ISLAND);
}

// Exported for the same reason `markDocument()` above is (BB-421 Task 8): a
// step that has to assert the mark WITHOUT the feature file spending a line on
// `the document was not reloaded` — the create-project dialog's "close it and
// open it again" is one Gherkin step that closes, navigates, re-marks and
// re-opens — must read the SAME mark rather than derive a second one. Two
// readers of one mark is fine; two marks would be two meanings.
export async function documentWasKept(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__bakers396_mark === 'kept',
  );
}

/**
 * The Members island, matched by SHAPE rather than by its exact id.
 *
 * The id is `island-<host>-<plugin>` (spec F42), so it is `island-team-members`
 * here and `island-project-members` on the project screen. BB-419 makes those
 * two ids address ONE component, and a step that hardcoded the team's id would
 * force a second copy of every member step for the second screen — which is the
 * duplication the ticket exists to prevent, reproduced in the test suite.
 *
 * Exported so the project feature's steps match the same node.
 */
export const MEMBERS_ISLAND = '[id^="island-"][id$="-members"]';

/**
 * The autocomplete string Drupal's member picker parses: "Label (id)".
 *
 * Gherkin names a seed account (`both-bakeries`) rather than a uid, because the
 * sequential id is insertion-order and the picker is limited to current-
 * workspace members. uid 1 is not on that list after the workspace-member
 * handler, so a hardcoded `admin (1)` never grows a row. A seed username is
 * stable in recipe-test; this helper turns it into the Label (id) form the
 * widget actually consumes. A string that already carries `(digits)` is left
 * alone so older call sites keep working.
 */
export function memberHandle(value: string): string {
  if (/\(\d+\)\s*$/.test(value)) {
    return value;
  }
  const safe = value.replace(/["'\\$]/g, '');
  const php =
    'print (($a = current(\\Drupal::entityTypeManager()->getStorage("user")' +
    `->loadByProperties(["name" => "${safe}"]))) ? $a->getAccountName() . " (" . $a->id() . ")" : "");`;
  const handle = Drush.exec(`ev '${php}'`).trim();
  if (!handle) {
    throw new Error(`No user named "${value}" exists in the seeded world.`);
  }
  return handle;
}

/**
 * The uid inside a seed username or an entity_autocomplete "Label (id)" string.
 *
 * The ID and never the label: uid 1 is `admin` on a stock install but
 * `placeholder-for-uid-1` on a `--provider recipe-test` world, so a step that
 * matched on the visible name would match nothing there — measured, not feared.
 */
export function uidOf(value: string): string {
  const uid = memberHandle(value).match(/\((\d+)\)\s*$/)?.[1];
  if (!uid) {
    throw new Error(`Name the account as a seed username or "Label (id)"; got "${value}".`);
  }
  return uid;
}

/** JavaScript errors a page raised since `I open a themed workspace screen`. */
export const pageErrors = new WeakMap<Page, string[]>();
