// The browser proof that a Settings tab is the entity's own edit form and
// saves only on an explicit Save. Nothing on the PHP side can show that a blur
// does NOT reach storage, or that a native Save round trip does, so this
// drives real edits through a real browser and reads storage through Drush.
//
// Every scenario builds its own disposable workspace, group, team and project,
// owned by a throwaway account and led by the recipe's `user.lead`. Renaming
// a seeded fixture instead would race the concurrent features that assert
// `workspace.home`'s name text. Routes are resolved by route name from the
// created entities' own route parameters (workspace slug, project key), never
// hardcoded.
import { randomUUID } from 'node:crypto';
import { createBdd } from 'playwright-bdd';
import { Drush } from '../../support/drush';
import type { Page, Request } from '@playwright/test';
import { test, expect } from '../../bdd.fixtures';

const { Given, When, Then, After } = createBdd(test);

type Surface = 'workspace' | 'project' | 'group';

interface SettingsWorld {
  slug: string;
  projectPage: string;
  ids: Record<Surface, string>;
  urls: Record<Surface, string>;
  names: Record<Surface, string>;
}

let world: SettingsWorld | undefined;
let current: Surface = 'project';
let strangerStatus: number | undefined;

function php(code: string): string {
  return Drush.exec(`php:eval '${code}'`).trim();
}

function storedField(surface: Surface, field: string): string {
  if (!world) throw new Error('No disposable Settings world was built.');
  return php(
    `\\Drupal::entityTypeManager()->getStorage("bb_${surface}")->resetCache(); ` +
      `print \\Drupal::entityTypeManager()->getStorage("bb_${surface}")->load(${world.ids[surface]})->get("${field}")->value;`,
  );
}

function removeWorld(slug: string): void {
  php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "${slug}"]));`,
      'if ($w) {',
      'foreach ($etm->getStorage("bb_group")->loadByProperties(["workspace_id" => $w->id()]) as $g) {',
      'foreach ($etm->getStorage("bb_project")->loadByProperties(["group_id" => $g->id()]) as $p) { $p->delete(); }',
      '$g->delete(); }',
      'foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => $w->id()]) as $t) { $t->delete(); }',
      '$owner = $w->get("owner_user_id")->target_id;',
      '$w->delete();',
      'if ($owner) { $etm->getStorage("user")->load($owner)?->delete(); } }',
    ].join(' '),
  );
}

After({ tags: '@feature:settings-tabs' }, async () => {
  if (!world) return;
  const { slug } = world;
  world = undefined;
  removeWorld(slug);
});

function nameField(page: Page) {
  return page.getByLabel('Name', { exact: true });
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Save', exact: true });
}

/** Clicks Save and waits for the native document round trip to land. */
async function save(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent('load'), saveButton(page).click()]);
}

// Shared with `workspace-invite.feature`: the recipe's `user.lead`, resolved
// by fixture uuid rather than a hardcoded uid.
Given('I am signed in as a workspace lead', async ({ page, authProvider, apiClient }) => {
  const uuid = apiClient.fixtureId('user.lead');
  const uid = Number(
    php(`$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${uuid}"); if (!$a) { throw new \\RuntimeException("Missing account fixture"); } print $a->id();`),
  );
  expect(uid, 'no account fixture user.lead').toBeGreaterThan(0);
  await authProvider.login(page, String(uid));
});

Given('I lead a disposable workspace world', async ({ page, authProvider, apiClient }) => {
  const suffix = randomUUID().slice(0, 8);
  const slug = `settings-${suffix}`;
  const lead = apiClient.fixtureId('user.lead');
  const out = php(
    [
      '$etm = \\Drupal::entityTypeManager();',
      `$lead = $etm->getStorage("user")->loadByProperties(["uuid" => "${lead}"]); $lead = reset($lead);`,
      `$owner = $etm->getStorage("user")->create(["name" => "${slug}-owner", "status" => 1]); $owner->save();`,
      `$w = $etm->getStorage("bb_workspace")->create(["name" => "Settings ${suffix}", "slug" => "${slug}", "owner_user_id" => $owner->id()]); $w->save();`,
      `$g = $etm->getStorage("bb_group")->create(["name" => "Settings group ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $g->save();`,
      `$t = $etm->getStorage("bb_team")->create(["name" => "Settings team ${suffix}", "workspace_id" => $w->id(), "owner_user_id" => $owner->id()]); $t->save();`,
      `$p = $etm->getStorage("bb_project")->create(["name" => "Settings project ${suffix}", "key" => "S${suffix.toUpperCase().replace(/[^A-Z]/g, 'X').slice(0, 5)}", "group_id" => $g->id(), "teams" => [$t->id()], "owner_user_id" => $owner->id()]); $p->save();`,
      '\\Drupal\\og\\Og::createMembership($w, $lead)->setRoles([$etm->getStorage("og_role")->load("bb_workspace-bb_workspace-lead")])->save();',
      '\\Drupal\\og\\Og::createMembership($t, $lead)->setRoles([$etm->getStorage("og_role")->load("bb_team-bb_team-lead")])->save();',
      '\\Drupal::service("cache.static")->deleteAll();',
      'print json_encode([',
      '"uid" => $lead->id(),',
      '"ids" => ["workspace" => $w->id(), "project" => $p->id(), "group" => $g->id()],',
      '"projectPage" => $p->toUrl()->toString(),',
      '"names" => ["workspace" => $w->label(), "project" => $p->label(), "group" => $g->label()],',
      '"urls" => [',
      '"workspace" => \\Drupal\\Core\\Url::fromRoute("bb_core.bb_workspace.settings", ["bb_workspace" => $w->getSlug()])->toString(),',
      '"project" => \\Drupal\\Core\\Url::fromRoute("bb_core.bb_project.settings", $p->toUrl()->getRouteParameters())->toString(),',
      '"group" => \\Drupal\\Core\\Url::fromRoute("bb_core.bb_group.settings", $g->toUrl()->getRouteParameters())->toString(),',
      ']]);',
    ].join(' '),
  );
  const built = JSON.parse(out) as Omit<SettingsWorld, 'slug'> & { uid: string };
  world = { slug, projectPage: built.projectPage, ids: built.ids, urls: built.urls, names: built.names };
  await authProvider.login(page, String(built.uid));
});

When('I open the {word} Settings', async ({ page }, surface: Surface) => {
  if (!world) throw new Error('No disposable Settings world was built.');
  current = surface;
  const response = await page.goto(world.urls[surface]);
  expect(response?.status()).toBe(200);
  await expect(nameField(page)).toHaveValue(world.names[surface]);
});

When('I open the project page', async ({ page }) => {
  if (!world) throw new Error('No disposable Settings world was built.');
  current = 'project';
  const response = await page.goto(world.projectPage);
  expect(response?.status()).toBe(200);
});

// A tab click is an htmx GET, and core's `htmx-assets.js` puts
// `ajax_page_state[...]` on its query. Carried into the native Save, it tells
// Drupal every library is already loaded: the landing page has no CSS or JS.
Then('the page loaded its own assets without htmx transport keys', async ({ page }) => {
  expect(page.url()).not.toContain('ajax_page_state');
  expect(await page.locator('link[rel="stylesheet"]').count()).toBeGreaterThan(0);
  expect(await page.locator('script[src]').count()).toBeGreaterThan(0);
});

// No entity write may follow an edit: the old autosave POSTed on change
// (debounced 100 ms), so blur, dispatch change and observe a bounded window
// in which no POST leaves the page. Lookup GETs are allowed.
When('I set the name to {string} and leave the field', async ({ page }, value: string) => {
  const posts: string[] = [];
  const onRequest = (request: Request) => {
    if (request.method() === 'POST') posts.push(request.url());
  };
  page.on('request', onRequest);
  await nameField(page).fill(value);
  await nameField(page).blur();
  await nameField(page).dispatchEvent('change');
  // Five times the old debounce: long enough for any autosave POST to leave.
  await page.waitForTimeout(500);
  page.off('request', onRequest);
  expect(posts, 'an edit sent a POST before Save').toEqual([]);
});

When('I set the name to {string} and save the Settings', async ({ page }, value: string) => {
  await nameField(page).fill(value);
  await save(page);
});

When('I save the Settings', async ({ page }) => {
  await save(page);
});

Then('the {word} name is still stored unchanged', async ({}, surface: Surface) => {
  expect(storedField(surface, 'name')).toBe(world!.names[surface]);
});

Then('the {word} name is stored as {string}', async ({}, surface: Surface, value: string) => {
  expect(storedField(surface, 'name')).toBe(value);
});

Then('Save is visible and reachable by keyboard', async ({ page }) => {
  await expect(saveButton(page)).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
  await nameField(page).focus();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await saveButton(page).evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Save was not reached by Tab from the name field.');
});

// Settings and the ticket properties share one save pattern: Save sits in a
// right-aligned action row that follows every field (a Settings row may add a
// secondary link after Save). Measured on the rendered boxes, not on classes.
Then('the form Save sits at the right of the action row below its fields', async ({ page }) => {
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toHaveCount(1);
  const form = page.locator('form').filter({ has: save });
  const geometry = await form.evaluate((element) => {
    const button = Array.from(element.querySelectorAll('button, input[type="submit"]'))
      .find((control) => (control.textContent || (control as HTMLInputElement).value || '').trim() === 'Save')!;
    const actions = button.parentElement!;
    const row = actions.getBoundingClientRect();
    const fields = Array.from(element.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea, [data-option-picker-trigger]'))
      .filter((control) => !actions.contains(control))
      .map((control) => control.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    const controls = Array.from(actions.children).map((child) => child.getBoundingClientRect()).filter((box) => box.width > 0);
    return {
      lastRight: Math.max(...controls.map((box) => box.right)),
      rowRight: row.right,
      rowTop: row.top,
      lowestField: Math.max(...fields.map((box) => box.bottom)),
    };
  });
  expect(geometry.rowRight - geometry.lastRight).toBeLessThanOrEqual(1);
  expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.lowestField);
});

// A status message is a toast: announced as a status, fixed at the viewport's
// bottom-right corner, and hidden again after a few seconds.
Then('the saved confirmation is a toast that hides again', async ({ page }) => {
  const toast = page.locator('#messages-status');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveText(/ saved\.$/);
  const box = (await toast.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(viewport.width - (box.x + box.width)).toBeLessThan(48);
  expect(viewport.height - (box.y + box.height)).toBeLessThan(48);
  await expect(toast).toBeHidden({ timeout: 8000 });
});

Then('I am on the {word} Settings with a saved message', async ({ page }, surface: Surface) => {
  expect(new URL(page.url()).pathname).toBe(world!.urls[surface]);
  await expect(page.getByText(/ saved\.\s*$/).first()).toBeVisible();
  await expect(saveButton(page)).toBeVisible();
});

Then('the workspace slug is unchanged', async () => {
  expect(storedField('workspace', 'slug')).toBe(world!.slug);
});

// `novalidate` skips the browser's `required` check so the request reaches
// Form API: the server must reject it, not the client.
When('I submit the name empty past browser validation', async ({ page }) => {
  await nameField(page).fill('');
  await page.locator('form[data-bakers-tab-body="settings"]').evaluate((form) => form.setAttribute('novalidate', ''));
  await save(page);
});

Then('the name is reported as required', async ({ page }) => {
  await expect(page.getByText(/Name field is required/).first()).toBeVisible();
  await expect(nameField(page)).toHaveValue('');
  expect(new URL(page.url()).pathname).toBe(world!.urls[current]);
});

Then('the name field shows the stored project name', async ({ page }) => {
  await expect(nameField(page)).toHaveValue(world!.names.project);
  expect(storedField('project', 'name')).toBe(world!.names.project);
});

When('I set the name to {string} and submit with a tampered form token', async ({ page }, value: string) => {
  await nameField(page).fill(value);
  await page.locator('form[data-bakers-tab-body="settings"] input[name="form_token"]').evaluate((input) => {
    (input as HTMLInputElement).value = 'forged';
  });
  await save(page);
});

When('a stranger requests the project Settings', async ({ page, authProvider, apiClient }) => {
  const uuid = apiClient.fixtureId('user.stranger');
  const uid = php(`$a = \\Drupal::service("entity.repository")->loadEntityByUuid("user", "${uuid}"); print $a->id();`);
  await authProvider.login(page, uid);
  const response = await page.goto(world!.urls.project);
  strangerStatus = response?.status();
});

Then('the stranger is denied', async () => {
  expect(strangerStatus).toBe(403);
  expect(storedField('project', 'name')).toBe(world!.names.project);
});
