import { When, Then } from '@key-tec/playwright-core/bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { php } from '../../support/drush';

type Subject = 'group' | 'team';
type Context = { type: Subject; workspace: string; owner: string; initial: number; names: string[] };
const contexts = new WeakMap<Page, Context>();
const labels = { group: { title: 'New group', submit: 'Create group' }, team: { title: 'New team', submit: 'Create team' } };
const dialog = (page: Page) => page.locator(`dialog[open]:has(form#bb-${context(page).type}-create-form)`);
const nameField = (page: Page) => dialog(page).locator('input[name="name[0][value]"]');
const descriptionField = (page: Page) => dialog(page).locator('textarea[name="description[0][value]"]');
function context(page: Page): Context {
  const value = contexts.get(page);
  if (!value) throw new Error('Open a shared create action first.');
  return value;
}
// Scoped to one owner: the workspace is shared with every other scenario, so
// only the rows this scenario's actor owns can be counted without racing them.
function rows(type: Subject, workspace: string, owner: string): Array<{ name: string; owner: string; workspace: string }> {
  return (JSON.parse(php(`$s = \\Drupal::entityTypeManager()->getStorage("bb_${type}"); $w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${workspace}"])); $rows = []; foreach ($s->loadByProperties(["workspace_id" => $w->id()]) as $e) { $rows[] = ["name" => $e->label(), "owner" => (string) $e->get("owner_user_id")->target_id, "workspace" => $e->get("workspace_id")->entity->getSlug()]; } print json_encode($rows);`)) as Array<{ name: string; owner: string; workspace: string }>).filter(row => row.owner === owner);
}
async function open(page: Page): Promise<void> {
  const state = context(page);
  const trigger = page.getByRole('link', { name: labels[state.type].title, exact: true });
  await expect(trigger).toBeVisible();
  await expect.poll(() => trigger.evaluate(el => !!(el as any)['htmx-internal-data'])).toBe(true);
  const answer = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes(`/${state.type}/create`) && response.url().includes('island_dialog'));
  await trigger.click();
  expect((await answer).status()).toBe(200);
  await expect(dialog(page)).toBeVisible();
}
function listingPath(type: Subject, workspace: string): string {
  return type === 'group' ? `/${workspace}/groups` : `/${workspace}/projects`;
}

When('I open the {string} creation action in {string}', async ({ page }, type: Subject, workspace: string) => {
  expect(['group', 'team']).toContain(type);
  expect(['bakers', 'other']).toContain(workspace);
  expect((await page.goto(listingPath(type, workspace)))?.status()).toBe(200);
  const owner = await page.evaluate(() => String((window as any).drupalSettings.user.uid));
  contexts.set(page, { type, workspace, owner, initial: rows(type, workspace, owner).length, names: [] });
  await open(page);
});
// A group offers Name, Description and Image; a team offers Name alone.
Then('the shared creation dialog shows only its identity fields', async ({ page }) => {
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page)).toHaveAccessibleName(labels[context(page).type].title);
  await expect(nameField(page)).toBeVisible();
  await expect(nameField(page)).toHaveAccessibleName('Name');
  const group = context(page).type === 'group';
  if (group) {
    await expect(descriptionField(page)).toHaveAccessibleName('Description');
    await expect(dialog(page).locator('input[type="file"][name^="files[image"]')).toHaveCount(1);
  }
  // The image's crop dialog nests in the form; its zoom slider is no field.
  await expect(dialog(page).locator(':is(input:not([type="hidden"]):not([type="submit"]), select, textarea):not([data-image-crop] dialog *)')).toHaveCount(group ? 3 : 1);
  await expect(dialog(page).getByRole('button', { name: labels[context(page).type].submit, exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('link', { name: 'Cancel', exact: true })).toBeVisible();
});
async function save(page: Page, name: string, repeatedClick = false): Promise<void> {
  const state = context(page);
  const documentMarker = `document-${Date.now()}`;
  await page.evaluate(marker => { (window as any).__creationDocument = marker; }, documentMarker);
  const listing = state.type === 'group' ? 'groups' : 'projects';
  const untouched = page.locator(`.views-element-container:has(#views-exposed-form-${listing}-workspace-list)`);
  await untouched.evaluateAll(elements => elements.forEach(el => el.setAttribute('data-creation-preserved', 'yes')));
  await nameField(page).fill(name);
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/${state.type}/create`));
  const button = dialog(page).getByRole('button', { name: labels[state.type].submit, exact: true });
  if (repeatedClick) await button.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  else await button.click();
  const answer = await response;
  expect(answer.status()).toBe(200);
  expect(answer.headers()['hx-redirect']).toBeUndefined();
  if (state.type === 'team') expect(answer.headers()['hx-location']).toBeUndefined();
  await expect(page).toHaveURL(new RegExp(`/${state.workspace}/${listing}$`));
  await expect(dialog(page)).toHaveCount(0);
  state.names.push(name);
  // This checks the refreshed production list, including the team rail.
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  if (state.type === 'team') {
    expect(await page.evaluate(() => (window as any).__creationDocument)).toBe(documentMarker);
    for (const element of await untouched.all()) await expect(element).toHaveAttribute('data-creation-preserved', 'yes');
  }
}
When('I create two {string} entries through the shared dialog', async ({ page }, type: Subject) => {
  expect(context(page).type).toBe(type);
  const prefix = `Crew ${type} ${Date.now()}`;
  await save(page, `${prefix} first`, true);
  await open(page);
  await save(page, `${prefix} second`);
});
Then('the created entries have the current owner and workspace', async ({ page }) => {
  const state = context(page);
  const stored = rows(state.type, state.workspace, state.owner);
  expect(stored).toHaveLength(state.initial + state.names.length);
  for (const name of state.names) {
    expect(stored.filter(row => row.name === name)).toEqual([{ name, owner: state.owner, workspace: state.workspace }]);
    expect(rows(state.type, 'other', state.owner).filter(row => row.name === name)).toHaveLength(0);
  }
});
When('I submit invalid names and then a 255 character name', async ({ page }) => {
  const state = context(page);
  for (const value of ['', '   ', 'a'.repeat(256)]) {
    await nameField(page).evaluate((el: HTMLInputElement) => { el.removeAttribute('maxlength'); el.form!.noValidate = true; });
    await nameField(page).fill(value);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/${state.type}/create`));
    await dialog(page).getByRole('button', { name: labels[state.type].submit, exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(value.length > 255 ? '255' : 'Enter a name.');
    await expect(nameField(page)).toHaveValue(value);
    expect(rows(state.type, state.workspace, state.owner)).toHaveLength(state.initial);
  }
  const prefix = `Boundary ${Date.now()} `;
  await save(page, prefix + 'ä'.repeat(255 - prefix.length));
});
Then('cancel, close, and Escape each leave no new entry', async ({ page }) => {
  const state = context(page);
  for (const mode of ['cancel', 'close', 'escape']) {
    await nameField(page).fill(`Dismissed ${Date.now()}`);
    if (mode === 'cancel') await dialog(page).getByRole('link', { name: 'Cancel', exact: true }).click();
    if (mode === 'close') await dialog(page).locator('[data-dialog-close]').click();
    if (mode === 'escape') await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(rows(state.type, state.workspace, state.owner)).toHaveLength(state.initial);
    if (mode !== 'escape') await open(page);
  }
});
Then('both create actions and direct routes are denied in {string}', async ({ page }, workspace: string) => {
  expect(workspace).toBe('bakers');
  expect((await page.goto(`/${workspace}/groups`))?.status()).toBe(200);
  const owner = await page.evaluate(() => String((window as any).drupalSettings.user.uid));
  await expect(page.getByRole('link', { name: labels.group.title, exact: true })).toHaveCount(0);
  expect((await page.goto(`/${workspace}/projects`))?.status()).toBe(200);
  await expect(page.getByRole('link', { name: labels.team.title, exact: true })).toHaveCount(0);
  for (const type of ['group', 'team'] as const) {
    const before = rows(type, workspace, owner).length;
    for (const suffix of ['', '?_wrapper_format=island_dialog']) {
      const response = await page.request.get(`/${workspace}/${type}/create${suffix}`);
      expect(response.status()).toBe(403);
    }
    const response = await page.request.post(`/${workspace}/${type}/create`, { form: { 'name[0][value]': 'Forbidden', form_id: `bb_${type}_create_form` } });
    expect(response.status()).toBe(403);
    expect(rows(type, workspace, owner)).toHaveLength(before);
  }
});
Then('revoking the workspace lead rank prevents submission', async ({ page }) => {
  const state = context(page);
  const mutate = (restore: boolean) => php(`$u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "fixture-revocable"])); $w = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"])); $m = \\Drupal::service("og.membership_manager")->getMembership($w, $u); $r = \\Drupal::entityTypeManager()->getStorage("og_role")->load("bb_workspace-bb_workspace-lead"); $m->${restore ? 'addRole' : 'revokeRole'}($r)->save();`);
  await nameField(page).fill('Revoked creation');
  try {
    mutate(false);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/${state.type}/create`));
    await dialog(page).getByRole('button', { name: labels[state.type].submit, exact: true }).click();
    expect((await response).status()).toBe(403);
    expect(rows(state.type, state.workspace, state.owner)).toHaveLength(state.initial);
  } finally {
    mutate(true);
  }
});
