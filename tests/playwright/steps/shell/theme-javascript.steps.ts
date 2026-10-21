// Guards the global-scope accident the Alpine bundle shipped with, which
// every other gate was blind to. A second guarded defect — Alpine's `_`
// helper clobbering core's Underscore — retired with `core/modules/toolbar`
// itself (BB-683); see the feature file.
//
// WHY THIS IS A SCENARIO RATHER THAN A NOTE. The defect was silent after
// its first moment: the page logged one error and then behaved like a page
// whose widgets were merely "not wired", which is indistinguishable from a
// missing handler when you are reading a diff. A story cannot see them because
// Storybook runs the module through Vite rather than through Drupal's asset
// pipeline, and the pipeline is precisely what broke.
import { Then, When } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import { pageErrors as errors } from '../../support/shell';


Then('the page raised no JavaScript errors', async ({ page }) => {
  expect(
    errors.get(page) ?? [],
    'The page raised JavaScript errors — a bundle that throws once stops the rest of its script',
  ).toEqual([]);
});

Then("the theme's bundle is loaded as a module", async ({ page }) => {
  // NOT cosmetic. Served as a classic script the same bytes execute in global
  // scope, which is what the next assertion catches.
  //
  // `skin.js` is excluded by name, not swept in with the blanket selector: it
  // is a deliberate, documented exception (`bb_theme.libraries.yml`) to
  // "bundle is a module" — it has to run synchronously in <head>, before the
  // token CSS applies, to set `data-mode` ahead of first paint, which a
  // deferred module cannot do. Widening this assertion to admit it would stop
  // testing "is a module" at all; naming the one exception keeps the
  // assertion meaningful for every other bundle the theme ships.
  const types = await page
    .locator('script[src*="/bb_theme/dist/js/"]:not([src*="/dist/js/skin.js"])')
    .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).type));
  expect(types, "The theme ships no bundle on this page").not.toHaveLength(0);
  expect(types.every((type) => type === 'module'), `Bundle script types: ${types.join(', ')}`).toBe(true);
});
