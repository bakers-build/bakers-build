// The square crop on the project, group and workspace create and settings
// forms, read back as decoded pixels on every identity surface after a reload,
// including the page header of a project's or group's detail.
// Consumer: features/images/entity-identity-crop.feature. The crop dialog's own
// steps (drag, apply, moved) come from avatar-crop.steps.ts.
import { join } from 'node:path';
import { Given, When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';
import { optionRow, pickerPanel, pickerTrigger, waitForPickerBehaviour } from '../../support/picker';
import { avatarColour } from './avatar-crop.steps';

type Entity = 'project' | 'group' | 'workspace';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

/** Who creates each subject, where, and through which forms. */
const SUBJECT = {
  project: { creator: 'admin', workspace: 'bakers', type: 'bb_project', create: 'dialog[data-dialog][open] form#bb-project-create-form', settings: 'form[id^="bb-project-settings-form"]' },
  group: { creator: 'fixture-south-creator', workspace: 'other', type: 'bb_group', create: 'dialog[data-dialog][open] form#bb-group-create-form', settings: 'form[id^="bb-group-settings-form"]' },
  workspace: { creator: 'fixture-south-creator', workspace: '', type: 'bb_workspace', create: 'form#bb-workspace-create-form', settings: 'form[id^="bb-workspace-settings-form"]' },
} as const;

/** The subject this scenario created; one scenario at a time per worker. */
const state = { entity: 'project' as Entity, name: '', description: '', id: '', slug: '', form: '' };

const cropDialog = (page: Page) => page.getByRole('dialog', { name: 'Crop image' });
const form = (page: Page) => page.locator(state.form);
const field = (page: Page, name: string) => form(page).locator(`:is(input, textarea)[name="${name}[0][value]"]`);
const fileInput = (page: Page) => form(page).locator('input[type="file"][name^="files[image"]');
const editCrop = (page: Page) => form(page).getByRole('button', { name: 'Edit crop' });

function uidOf(name: string): string {
  const uid = php(`print (($u = current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${safe(name)}"]))) ? $u->id() : "");`);
  expect(uid, `No account named ${name}`).not.toBe('');
  return uid;
}

/** The created subject's id, and for a workspace its slug, by its unique name. */
function remember(): void {
  const found = JSON.parse(php(
    `$e = current(\\Drupal::entityTypeManager()->getStorage("${SUBJECT[state.entity].type}")->loadByProperties(["name" => "${safe(state.name)}"]));` +
      ' print json_encode($e ? ["id" => (string) $e->id(), "slug" => $e->hasField("slug") ? (string) $e->get("slug")->value : ""] : null);',
  )) as { id: string; slug: string } | null;
  expect(found, `The ${state.entity} "${state.name}" was not saved`).not.toBeNull();
  state.id = found!.id;
  state.slug = found!.slug;
}

function imageUri(): string {
  return php(`print (string) \\Drupal::entityTypeManager()->getStorage("${SUBJECT[state.entity].type}")->loadUnchanged(${Number(state.id)})->get("image")->entity?->getFileUri();`);
}

async function openCreateForm(page: Page): Promise<void> {
  const subject = SUBJECT[state.entity];
  state.form = subject.create;
  if (state.entity === 'workspace') {
    expect((await page.goto('/home/new-workspace'))?.status()).toBe(200);
  } else {
    const listing = `/${subject.workspace}/${state.entity}s`;
    expect((await page.goto(listing))?.status()).toBe(200);
    const trigger = page.getByRole('link', { name: `New ${state.entity}`, exact: true });
    // The trigger is a real link; a click before htmx owns it would navigate.
    await expect.poll(() => trigger.evaluate((el) => !!(el as unknown as Record<string, unknown>)['htmx-internal-data']), { timeout: 20000 }).toBe(true);
    await trigger.click();
  }
  await expect(form(page)).toBeVisible();
}

async function openSettingsForm(page: Page): Promise<void> {
  state.form = SUBJECT[state.entity].settings;
  const path = state.entity === 'workspace'
    ? `/${state.slug}/settings`
    : php(`print \\Drupal::entityTypeManager()->getStorage("${SUBJECT[state.entity].type}")->load(${Number(state.id)})->toUrl()->toString() . "/settings";`);
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
}

async function pick(page: Page, label: string, option: string): Promise<void> {
  const trigger = pickerTrigger(page, 'dialog[data-dialog]:has(form#bb-project-create-form)', label);
  await waitForPickerBehaviour(trigger);
  await trigger.click();
  await optionRow(page, pickerPanel(trigger), option).click();
  await expect(trigger).toContainText(option);
}

async function enterIdentity(page: Page, description: string): Promise<void> {
  // Unique within its first ten letters and digits: a project's key, and
  // with it its address, is derived from them.
  state.name = `C${Date.now().toString().slice(-9)} crop ${state.entity}`;
  state.description = description;
  await field(page, 'name').fill(state.name);
  await field(page, 'description').fill(description);
  if (state.entity === 'project' && state.form === SUBJECT.project.create) {
    await pick(page, 'Group', 'Bread');
    await pick(page, 'Teams', 'Platform Crew');
  }
}

async function chooseImage(page: Page, file: string): Promise<void> {
  await fileInput(page).setInputFiles(join(FIXTURES, file));
  await expect(cropDialog(page)).toBeVisible();
}

/** Submits whichever form is open and waits until the save has landed. */
async function submit(page: Page): Promise<void> {
  const creating = state.form === SUBJECT[state.entity].create;
  if (creating && state.entity !== 'workspace') {
    // The footer action sits outside the form, bound by its `form` attribute;
    // a successful create closes the dialog and lands back on the listing.
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && !r.url().includes('element_parents'));
    await page.locator('dialog[data-dialog][open]').getByRole('button', { name: `Create ${state.entity}`, exact: true }).click();
    expect((await response).status()).toBeLessThan(400);
    await expect(page.locator('dialog[data-dialog][open]')).toHaveCount(0, { timeout: 20000 });
    remember();
    return;
  }
  const navigation = page.waitForEvent('load');
  await form(page).getByRole('button', { name: creating ? 'Create workspace' : 'Save', exact: true }).click();
  await navigation;
  if (creating) {
    remember();
  }
}

/** The images that identify the subject: listing row, or switcher, entry and chooser. */
async function identityMarks(page: Page): Promise<Locator[]> {
  if (state.entity !== 'workspace') {
    expect((await page.goto(`/${SUBJECT[state.entity].workspace}/${state.entity}s`))?.status()).toBe(200);
    return [listingRow(page).locator('[data-list-region="avatar"]')];
  }
  expect((await page.goto(`/${state.slug}/tickets`))?.status()).toBe(200);
  const toggle = page.locator('[data-account-switcher-toggle="workspace"]');
  await toggle.click();
  const entry = page.locator('[role="menu"] a[role="menuitem"]').filter({ hasText: state.name }).first();
  await expect(entry).toBeVisible();
  return [toggle, entry];
}

function listingRow(page: Page): Locator {
  return page.locator('li[data-list-item]').filter({
    has: page.locator('[data-list-region="headline"] [data-cell="name"]', { hasText: state.name }),
  });
}

function chooserRow(page: Page): Locator {
  return page.locator('li[data-list-item]').filter({ has: page.locator('[data-cell="slug"]', { hasText: new RegExp(`^\\s*${state.slug}\\s*$`) }) });
}

/** Each identity surface's mark: its decoded image colour, or `initials`. */
async function identityColours(page: Page): Promise<string[]> {
  const colours: string[] = [];
  for (const mark of await identityMarks(page)) {
    colours.push(await markColour(page, mark));
  }
  if (state.entity === 'workspace') {
    expect((await page.goto('/home'))?.status()).toBe(200);
    colours.push(await markColour(page, chooserRow(page).locator('[data-cell="mark"]')));
  }
  else {
    // The detail page's header shows the mark beside the name.
    const detail = php(`print \\Drupal::entityTypeManager()->getStorage("${SUBJECT[state.entity].type}")->load(${Number(state.id)})->toUrl()->toString();`);
    expect((await page.goto(detail))?.status()).toBe(200);
    colours.push(await markColour(page, page.locator('[data-page-header]')));
  }
  return colours;
}

async function markColour(page: Page, scope: Locator): Promise<string> {
  await expect(scope.locator('[data-person-mark]').first()).toBeVisible();
  const image = scope.locator('img[data-person-mark]').first();
  return (await image.count()) ? avatarColour(page, image) : 'initials';
}

Given(/^I am logged in as the (project|group|workspace) creator$/, async ({ page, authProvider }, entity: Entity) => {
  state.entity = entity;
  await page.context().clearCookies();
  await authProvider.login(page, uidOf(SUBJECT[entity].creator));
});

When(/^I open the (?:project|group|workspace) create form$/, async ({ page }) => {
  await openCreateForm(page);
});

When(/^I open the (?:project|group|workspace) settings form$/, async ({ page }) => {
  await openSettingsForm(page);
});

When(/^I enter a (?:project|group|workspace) name and the description "(.*)"$/, async ({ page }, description: string) => {
  await enterIdentity(page, description);
});

When(/^I choose the image "([^"]+)" in the (?:project|group|workspace) form$/, async ({ page }, file: string) => {
  await chooseImage(page, file);
});

When(/^I submit the (?:project|group|workspace) form$/, async ({ page }) => {
  await submit(page);
});

When(/^I edit the crop of the (?:project|group|workspace) image$/, async ({ page }) => {
  await editCrop(page).click();
  await expect(cropDialog(page)).toBeVisible();
});

When(/^I dismiss the crop dialog with (Escape|Cancel)$/, async ({ page }, action: string) => {
  if (action === 'Escape') {
    await page.keyboard.press('Escape');
  } else {
    await cropDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await expect(cropDialog(page)).toBeHidden();
});

Then('only the crop dialog closed and Edit crop has focus', async ({ page }) => {
  await expect(form(page)).toBeVisible();
  if (state.entity !== 'workspace') {
    await expect(page.locator('dialog[data-dialog][open]')).toHaveCount(1);
  }
  await expect(editCrop(page)).toBeFocused();
});

Then(/^the (?:project|group|workspace) form still holds its name, description and image$/, async ({ page }) => {
  await expect(field(page, 'name')).toHaveValue(state.name);
  await expect(field(page, 'description')).toHaveValue(state.description);
  expect(await fileInput(page).evaluate((input: HTMLInputElement) => input.files?.length ?? 0)).toBe(1);
  await expect(editCrop(page)).toBeVisible();
});

Then(/^every identity image of the (?:project|group|workspace) shows "(red|yellow|grey)"$/, async ({ page }, colour: string) => {
  for (const seen of await identityColours(page)) {
    expect(seen).toBe(colour);
  }
});

Then(/^every identity surface of the (?:project|group|workspace) shows its initials$/, async ({ page }) => {
  for (const seen of await identityColours(page)) {
    expect(seen).toBe('initials');
  }
});

Then(/^every description surface of the (?:project|group|workspace) reads "(.*)"$/, async ({ page }, description: string) => {
  if (state.entity !== 'workspace') {
    expect((await page.goto(`/${SUBJECT[state.entity].workspace}/${state.entity}s`))?.status()).toBe(200);
    await expect(listingRow(page).locator('[data-list-region="description"]')).toHaveText(description);
    return;
  }
  const [, entry] = await identityMarks(page);
  await expect(entry).not.toContainText(description);
  expect((await page.goto('/home'))?.status()).toBe(200);
  await expect(chooserRow(page).locator('[data-cell="description"]')).toHaveText(description);
});

Then(/^the (?:project|group|workspace) identity surfaces fit a screen (\d+) pixels wide$/, async ({ page }, width: string) => {
  await page.setViewportSize({ width: Number(width), height: 740 });
  const paths = state.entity === 'workspace' ? ['/home'] : [`/${SUBJECT[state.entity].workspace}/${state.entity}s`];
  for (const path of paths) {
    expect((await page.goto(path))?.status()).toBe(200);
    const row = state.entity === 'workspace' ? chooserRow(page) : listingRow(page);
    await expect(row).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways at ${width} pixels`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});

When(/^I clear the (?:project|group|workspace) name and submit the (?:project|group|workspace) form$/, async ({ page }) => {
  await form(page).evaluate((element: HTMLFormElement) => { element.noValidate = true; });
  await field(page, 'name').fill('');
  await submit(page);
});

Then(/^the (?:project|group|workspace) form refuses the empty name$/, async ({ page }) => {
  await expect(field(page, 'name')).toHaveAttribute('aria-invalid', 'true');
});

When(/^I remove the (?:project|group|workspace) image$/, async ({ page }) => {
  const navigation = page.waitForEvent('load');
  await form(page).getByRole('button', { name: 'Remove', exact: true }).click();
  await navigation;
  await expect(form(page).getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
});

Given(/^I have created a (?:project|group|workspace) with a cropped image$/, async ({ page }) => {
  await openCreateForm(page);
  await enterIdentity(page, 'Cropped on creation.');
  await chooseImage(page, 'avatar-wide.png');
  const box = await cropDialog(page).getByRole('img', { name: 'Image to crop' }).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 400, box!.y + box!.height / 2, { steps: 20 });
  await page.mouse.up();
  await cropDialog(page).getByRole('button', { name: 'Apply' }).click();
  await submit(page);
  expect(imageUri(), 'The image was not saved').not.toBe('');
});

/**
 * The avatar crop's twin that no page renders. Parallel scenarios render the
 * subject's listing and so regenerate its `avatar` crop at any moment; only
 * a style nothing else requests shows who generated a derivative.
 */
const probeStyle = (): string => `avatar_probe_${state.entity}`;

/** The original, its avatar crop and, once created, the probe crop. */
function imageUrls(): string[] {
  const uri = imageUri();
  return JSON.parse(php(
    `$u = "${safe(uri)}"; $urls = [\\Drupal::service("file_url_generator")->generateString($u)];` +
      ` foreach (array_filter([\\Drupal\\image\\Entity\\ImageStyle::load("avatar"), \\Drupal\\image\\Entity\\ImageStyle::load("${probeStyle()}")]) as $style) { $urls[] = parse_url($style->buildUrl($u), PHP_URL_PATH) . "?" . parse_url($style->buildUrl($u), PHP_URL_QUERY); }` +
      ' print json_encode($urls);',
  )) as string[];
}

/** Whether the probe crop of the subject's image exists on disk. */
function cropGenerated(): boolean {
  const derivative = php(`print \\Drupal\\image\\Entity\\ImageStyle::load("${probeStyle()}")->buildUri("${safe(imageUri())}");`);
  return php(`print (int) file_exists("${safe(derivative)}");`) === '1';
}

Given('its crop has not been generated yet', async () => {
  // The same crop effect as `avatar`, under a name only this scenario requests.
  php(
    `$id = "${probeStyle()}"; $style = \\Drupal\\image\\Entity\\ImageStyle::load($id);` +
      ' if (!$style) { $style = \\Drupal\\image\\Entity\\ImageStyle::load("avatar")->createDuplicate(); $style->set("name", $id); $style->set("label", $id); $style->save(); }' +
      ` $style->flush("${safe(imageUri())}");`,
  );
  expect(cropGenerated()).toBe(false);
});

// An outsider's request must not have generated the crop either.
Then('its crop is still not generated', async () => {
  expect(cropGenerated()).toBe(false);
});

Then(/^anonymous visitors and "([^"]+)" cannot read its image or its crop$/, async ({ page, authProvider }, outsider: string) => {
  const urls = imageUrls();
  for (const account of ['', outsider]) {
    await page.context().clearCookies();
    if (account) {
      await authProvider.login(page, uidOf(account));
    }
    for (const url of urls) {
      const response = await page.request.get(url, { maxRedirects: 0 });
      const who = `${account || 'anonymous'} read ${url}`;
      // Anonymous visitors are sent to log in rather than refused outright.
      if (response.status() === 302) {
        expect(response.headers().location ?? '', who).toContain('/user/login');
      } else {
        expect([403, 404], who).toContain(response.status());
      }
      expect(response.headers()['content-type'] ?? '', who).not.toMatch(/^image\//);
    }
  }
});

Then(/^its (?:member "([^"]+)"|owner) can read its image and its crop$/, async ({ page, authProvider }, member: string | undefined) => {
  await page.context().clearCookies();
  await authProvider.login(page, uidOf(member ?? SUBJECT[state.entity].creator));
  for (const url of imageUrls()) {
    const response = await page.request.get(url, { maxRedirects: 0 });
    expect(response.status(), `${url} for the member`).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\//);
    expect((await response.body()).length).toBeGreaterThan(0);
  }
  // The crop now exists on disk; the outsiders are asked again after this.
  expect(cropGenerated()).toBe(true);
});

Then(/^I delete the (?:project|group|workspace)$/, async () => {
  const type = SUBJECT[state.entity].type;
  php(
    `$etm = \\Drupal::entityTypeManager(); $e = $etm->getStorage("${type}")->load(${Number(state.id)});` +
      (state.entity === 'workspace' ? ` foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => ${Number(state.id)}]) as $t) { $t->delete(); }` : '') +
      ' if ($e) { $e->delete(); }' +
      ` \\Drupal\\image\\Entity\\ImageStyle::load("${probeStyle()}")?->delete();`,
  );
});
