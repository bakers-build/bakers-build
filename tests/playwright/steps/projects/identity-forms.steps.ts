// Description and Image on the group create dialog and the project/group
// settings forms, read back from storage and from the listing row.
// Consumer: features/projects/identity-forms.feature.
import { join } from 'node:path';
import { When, Then } from '../../bdd.fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const CREATE_DESCRIPTION = 'Created through the dialog —\ngrößer als nötig.';
const WORKSPACE_DESCRIPTION = 'Described when\nit was created.';

/** A feature's description argument: a literal `\n` is a line break. */
const lines = (text: string): string => text.replace(/\\n/g, '\n');

/** The rendered text, line breaks included, of a description region. */
async function expectLines(scope: Locator, text: string): Promise<void> {
  await expect(scope).toBeVisible();
  await expect.poll(() => scope.innerText().then((value) => value.trim())).toBe(text);
}

/** The entity this scenario works on, and what it was seeded with. */
const state: { type: 'bb_group' | 'bb_project' | 'bb_workspace'; id: string; name: string; workspace: string; seeded: string; form: string } = {
  type: 'bb_group',
  id: '',
  name: '',
  workspace: '',
  seeded: '',
  form: '',
};

function stored(): { description: string; image: string } {
  return JSON.parse(php(
    `$e = \\Drupal::entityTypeManager()->getStorage("${state.type}")->loadUnchanged(${Number(state.id)});` +
      ' print json_encode(["description" => str_replace("\\r\\n", "\\n", (string) $e->get("description")->value), "image" => (string) $e->get("image")->target_id]);',
  ));
}

function settingsPath(): string {
  if (state.type === 'bb_workspace') {
    return `/${state.workspace}/settings`;
  }
  return php(
    `print \\Drupal::entityTypeManager()->getStorage("${state.type}")->load(${Number(state.id)})->toUrl()->toString() . "/settings";`,
  );
}

function form(page: Page): Locator {
  return page.locator(state.form);
}

function descriptionField(scope: Locator): Locator {
  return scope.locator('textarea[name="description[0][value]"]');
}

function fileInput(scope: Locator): Locator {
  return scope.locator('input[type="file"][name^="files[image"]');
}

function removeButton(scope: Locator): Locator {
  return scope.locator('input[type="submit"][name^="image_0_remove_button"], button[name^="image_0_remove_button"]');
}

const cropDialog = (page: Page) => page.getByRole('dialog', { name: 'Crop image' });

/**
 * Chooses an image and applies its centred crop. The square crop widget has
 * no Ajax upload: the file travels with the form's submit, and choosing it
 * opens the crop dialog.
 */
async function upload(page: Page, file: string): Promise<void> {
  await fileInput(form(page)).setInputFiles(join(FIXTURES, file));
  await expect(cropDialog(page)).toBeVisible();
  await cropDialog(page).getByRole('button', { name: 'Apply' }).click();
  await expect(cropDialog(page)).toBeHidden();
}

/** Removes the saved image; core's Remove rebuilds the form in a full submit. */
async function removeImage(page: Page): Promise<void> {
  const navigation = page.waitForEvent('load');
  await removeButton(form(page)).click();
  await navigation;
  await expect(removeButton(form(page))).toHaveCount(0);
}

/** The listing row of the entity, by its headline name. */
function listingRow(page: Page): Locator {
  return page.locator('li[data-list-item]').filter({
    has: page.locator('[data-list-region="headline"] [data-cell="name"]', { hasText: state.name }),
  });
}

When(
  'I create a group in {string} with a description and the image {string}',
  async ({ page }, workspace: string, file: string) => {
    state.type = 'bb_group';
    state.workspace = workspace;
    state.name = `Identity group ${Date.now()}`;
    state.form = 'dialog[open] form#bb-group-create-form';
    expect((await page.goto(`/${workspace}/groups`))?.status()).toBe(200);
    const trigger = page.getByRole('link', { name: 'New group', exact: true });
    await expect.poll(() => trigger.evaluate((el) => !!(el as any)['htmx-internal-data'])).toBe(true);
    await trigger.click();
    await expect(form(page)).toBeVisible();
    await form(page).locator('input[name="name[0][value]"]').fill(state.name);
    await descriptionField(form(page)).fill(CREATE_DESCRIPTION);
    // The file travels with the multipart Create.
    await upload(page, file);
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/group/create') && !r.url().includes('element_parents'));
    // The footer action is bound to the form by its `form` attribute.
    await page.locator('dialog[open]').getByRole('button', { name: 'Create group', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    state.id = php(
      `print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_group")->loadByProperties(["name" => "${safe(state.name)}"]))) ? $e->id() : "");`,
    );
    expect(state.id, 'The group was not created').not.toBe('');
  },
);

When(
  'I create a workspace with a description and the image {string}',
  async ({ page }, file: string) => {
    state.type = 'bb_workspace';
    state.name = `Identity workspace ${Date.now()}`;
    state.form = 'form#bb-workspace-create-form';
    expect((await page.goto('/home/new-workspace'))?.status()).toBe(200);
    await page.getByLabel('Workspace name', { exact: true }).fill(state.name);
    await page.getByLabel('Team name', { exact: true }).fill('Core Team');
    await descriptionField(form(page)).fill(WORKSPACE_DESCRIPTION);
    await upload(page, file);
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    // The first project is asked on the next page; Skip leaves it for later.
    await page.waitForURL('**/home/first-project/**', { waitUntil: 'load' });
    const navigation = page.waitForURL('**/tickets', { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await navigation;
    const found = JSON.parse(php(
      `$e = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["name" => "${safe(state.name)}"]));` +
        ' print json_encode($e ? ["id" => (string) $e->id(), "slug" => $e->getSlug()] : null);',
    )) as { id: string; slug: string } | null;
    expect(found, 'The workspace was not created').not.toBeNull();
    state.id = found!.id;
    state.workspace = found!.slug;
  },
);

Then('the created workspace stores that description and an image', async () => {
  const values = stored();
  expect(values.description).toBe(WORKSPACE_DESCRIPTION);
  expect(values.image).not.toBe('');
});

Then('the switcher of that workspace shows its image', async ({ page }) => {
  expect((await page.goto(`/${state.workspace}/tickets`))?.status()).toBe(200);
  const toggle = page.locator('[data-account-switcher-toggle="workspace"]');
  await expect(toggle).toBeVisible();
  expect(await markOf(toggle)).toBe('image');
});

Then('I delete that workspace', async () => {
  php(
    `$etm = \\Drupal::entityTypeManager(); foreach ($etm->getStorage("bb_team")->loadByProperties(["workspace_id" => ${Number(state.id)}]) as $t) { $t->delete(); } $etm->getStorage("bb_workspace")->load(${Number(state.id)})->delete();`,
  );
});

Then('the created group stores that description and an image', async () => {
  const values = stored();
  expect(values.description).toBe(CREATE_DESCRIPTION);
  expect(values.image).not.toBe('');
});

Then(
  'the {string} groups row of that group shows its image and description',
  async ({ page }, workspace: string) => {
    expect((await page.goto(`/${workspace}/groups`))?.status()).toBe(200);
    const row = listingRow(page);
    await expect(row).toHaveCount(1);
    const image = row.locator('[data-list-region="avatar"] img');
    await expect(image).toHaveCount(1);
    // The private file really loads for its reader.
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expectLines(row.locator('[data-list-region="description"]'), CREATE_DESCRIPTION);
  },
);

Then(
  'the {string} groups row of that group shows its initials and {string}',
  async ({ page }, workspace: string, description: string) => {
    expect((await page.goto(`/${workspace}/groups`))?.status()).toBe(200);
    const row = listingRow(page);
    await expect(row).toHaveCount(1);
    const avatar = row.locator('[data-list-region="avatar"]');
    await expect(avatar.locator('img')).toHaveCount(0);
    await expect(avatar).toHaveText('IG');
    await expectLines(row.locator('[data-list-region="description"]'), lines(description));
  },
);

When("I open that group's settings", async ({ page }) => {
  state.form = 'form[id^="bb-group-settings-form"]';
  expect((await page.goto(settingsPath()))?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
});

When(
  'I replace its description with {string} and remove its image',
  async ({ page }, description: string) => {
    await descriptionField(form(page)).fill(lines(description));
    await removeImage(page);
    await save(page);
  },
);

async function save(page: Page): Promise<void> {
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && !r.url().includes('element_parents'));
  await form(page).getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).status()).toBeLessThan(400);
  await page.waitForLoadState('load');
}

When(/^I reload (?:that group's|the project's|the workspace's) settings$/, async ({ page }) => {
  expect((await page.goto(settingsPath()))?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
});

Then(
  /^the settings form reads "(.*)" and holds (an|no) image$/,
  async ({ page }, text: string, holds: string) => {
    const description = lines(text);
    await expect(descriptionField(form(page))).toHaveValue(description);
    await expect(removeButton(form(page))).toHaveCount(holds === 'an' ? 1 : 0);
    const values = stored();
    expect(values.description).toBe(description);
    expect(values.image === '').toBe(holds === 'no');
  },
);

When('I open the settings of the project {string}', async ({ page }, name: string) => {
  state.type = 'bb_project';
  state.name = name;
  state.id = php(
    `print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => "${safe(name)}"]))) ? $e->id() : "");`,
  );
  expect(state.id, `No project named ${name}`).not.toBe('');
  state.seeded = stored().description;
  state.form = 'form[id^="bb-project-settings-form"]';
  expect((await page.goto(settingsPath()))?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
});

When('I submit a {int} character description', async ({ page }, length: number) => {
  const field = descriptionField(form(page));
  await field.evaluate((el: HTMLInputElement) => { el.removeAttribute('maxlength'); el.form!.noValidate = true; });
  await field.fill('é'.repeat(length));
  await form(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForLoadState('load');
});

Then("the form names the Description field's 280 character limit", async ({ page }) => {
  await expect(page.getByText(/Description.*280/).first()).toBeVisible();
  await expect(descriptionField(form(page))).toHaveAttribute('aria-invalid', 'true');
  expect(stored().description).toBe(state.seeded);
});

Then('the other settings fields kept their values', async ({ page }) => {
  await expect(form(page).locator('input[name="name[0][value]"]')).toHaveValue(state.name);
});

When(
  'I set the description {string} and upload {string}',
  async ({ page }, description: string, file: string) => {
    await descriptionField(form(page)).fill(lines(description));
    await upload(page, file);
    await save(page);
  },
);

When('I upload {string} as the project image', async ({ page }, file: string) => {
  await removeImage(page);
  // Not an image: the crop dialog cannot load it, and Save submits it.
  await fileInput(form(page)).setInputFiles(join(FIXTURES, file));
  await form(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForLoadState('load');
});

Then('the upload is refused as not an image', async ({ page }) => {
  await expect(page.getByText(/not.*(image|allowed)|Only files with the following extensions/i).first()).toBeVisible({ timeout: 20000 });
  await expect(removeButton(form(page))).toHaveCount(0);
});

When(/^I restore the (?:project|workspace)'s seeded description and remove its image$/, async ({ page }) => {
  expect((await page.goto(settingsPath()))?.status()).toBe(200);
  await descriptionField(form(page)).fill(state.seeded);
  if (await removeButton(form(page)).count()) {
    await removeImage(page);
  }
  await save(page);
});

Then('the settings form reads the seeded description and holds no image', async ({ page }) => {
  await expect(descriptionField(form(page))).toHaveValue(state.seeded);
  await expect(removeButton(form(page))).toHaveCount(0);
  expect(stored()).toEqual({ description: state.seeded, image: '' });
});

Then(
  /^the (group|project) settings at "([^"]+)" are (offered|refused) to me$/,
  async ({ page }, type: string, path: string, verdict: string) => {
    // A group is named in the path, never numbered: serial ids follow the
    // fixture import order, which any new fixture can shift.
    const group = /^\/[^/]+\/group\/([^/]+)$/.exec(path);
    if (group && !/^\d+$/.test(group[1])) {
      const id = php(`print current(\\Drupal::entityTypeManager()->getStorage("bb_group")->loadByProperties(["name" => "${safe(group[1])}"]))->id();`);
      path = path.replace(/[^/]+$/, id);
    }
    // Viewing is the reader's own right and not under test; a reader sees the
    // page and no Settings link, an outsider sees neither.
    const view = await page.goto(path);
    if (verdict === 'offered') {
      expect(view?.status()).toBe(200);
      await expect(page.getByRole('link', { name: 'Settings', exact: true }).first()).toBeVisible();
    }
    else {
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
    }
    const settings = await page.goto(`${path}/settings`);
    expect(settings?.status()).toBe(verdict === 'offered' ? 200 : 403);
    const settingsForm = page.locator(`form[id^="bb-${type}-settings-form"]`);
    if (verdict === 'offered') {
      await expect(descriptionField(settingsForm)).toBeVisible();
      // The widget shows either the upload input or the current image's Remove.
      await expect(fileInput(settingsForm).or(removeButton(settingsForm))).toHaveCount(1);
    }
    else {
      await expect(settingsForm).toHaveCount(0);
    }
  },
);

Then(
  /^the "([^"]+)" listing (?:offers "([^"]+)"|is refused)$/,
  async ({ page }, path: string, action: string | undefined) => {
    const response = await page.goto(path);
    if (action) {
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('link', { name: action, exact: true })).toHaveCount(1);
    }
    else {
      // 403 or 404: the tenancy boundary may hide the workspace itself.
      expect([403, 404]).toContain(response?.status());
      await expect(page.locator('li[data-list-item]')).toHaveCount(0);
    }
  },
);

When('I open the settings of the workspace {string}', async ({ page }, slug: string) => {
  state.type = 'bb_workspace';
  state.workspace = slug;
  state.id = php(
    `print (($e = current(\\Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["slug" => "${safe(slug)}"]))) ? $e->id() : "");`,
  );
  expect(state.id, `No workspace ${slug}`).not.toBe('');
  state.seeded = stored().description;
  state.name = php(`print \\Drupal::entityTypeManager()->getStorage("bb_workspace")->load(${Number(state.id)})->label();`);
  state.form = 'form[id^="bb-workspace-settings-form"]';
  expect((await page.goto(settingsPath()))?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
});

/** The loaded mark: an image that rendered, or the initials text. */
async function markOf(scope: Locator): Promise<string> {
  const image = scope.locator('img[data-person-mark]').first();
  if (await image.count()) {
    return image.evaluate(async (element: HTMLImageElement) => {
      if (!element.complete) await new Promise((resolve) => { element.onload = element.onerror = resolve; });
      return element.naturalWidth > 0 ? 'image' : 'broken';
    });
  }
  return (await scope.locator('[data-person-mark]').first().textContent() ?? '').trim() ? 'initials' : 'none';
}

Then(/^the switcher of "([^"]+)" shows its (image|initials)$/, async ({ page }, slug: string, mark: string) => {
  expect((await page.goto(`/${slug}/tickets`))?.status()).toBe(200);
  const toggle = page.locator('[data-account-switcher-toggle="workspace"]');
  await expect(toggle).toBeVisible();
  expect(await markOf(toggle)).toBe(mark);
});

Then(
  'the switcher entry of {string} shows its image without {string}',
  async ({ page }, slug: string, description: string) => {
    expect((await page.goto(`/${slug}/tickets`))?.status()).toBe(200);
    await page.locator('[data-account-switcher-toggle="workspace"]').click();
    const entry = page.locator('[role="menu"] a[role="menuitem"]').filter({ hasText: state.name }).first();
    await expect(entry).toBeVisible();
    expect(await markOf(entry)).toBe('image');
    await expect(entry).not.toContainText(lines(description));
  },
);

Then(
  'the chooser row of {string} shows its image and {string}',
  async ({ page }, slug: string, description: string) => {
    expect((await page.goto('/home'))?.status()).toBe(200);
    const row = page.locator('li[data-list-item]').filter({ has: page.locator('[data-cell="slug"]', { hasText: new RegExp(`^\\s*${slug}\\s*$`) }) });
    await expect(row).toHaveCount(1);
    expect(await markOf(row.locator('[data-cell="mark"]'))).toBe('image');
    await expectLines(row.locator('[data-cell="description"]'), lines(description));
  },
);

Then(
  'the projects row of that project shows {string}',
  async ({ page }, description: string) => {
    const workspace = php(
      `print \\Drupal::entityTypeManager()->getStorage("bb_project")->load(${Number(state.id)})->get("group_id")->entity->get("workspace_id")->entity->getSlug();`,
    );
    expect((await page.goto(`/${workspace}/projects`))?.status()).toBe(200);
    const row = listingRow(page);
    await expect(row).toHaveCount(1);
    await expectLines(row.locator('[data-list-region="description"]'), lines(description));
  },
);

Then(/^at a phone width "([^"]+)" does not scroll sideways$/, async ({ page }, path: string) => {
  await page.setViewportSize({ width: 320, height: 640 });
  expect((await page.goto(path))?.status()).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

// The project settings form: Teams directly after Group, and the three
// repository inputs as one fieldset named Repository. The create dialog shares
// the fieldset but lays Teams out as a pill after its text lines, and hides
// Branch convention and Environment variables.
const PROJECT_FIELD_ORDER = ['group-id', 'teams', 'name', 'description', 'image', 'repository', 'owner-user-id', 'env-vars'];

Then('the project form groups the Repository', async ({ page }) => {
  const projectForm = page.locator('form#bb-project-create-form:visible, form[id^="bb-project-settings-form"]:visible').first();
  const repository = projectForm.getByRole('group', { name: 'Repository', exact: true });
  await expect(repository).toBeVisible();
  await expect(repository.getByRole('textbox', { name: 'URL', exact: true })).toBeVisible();
  await expect(repository.getByRole('textbox', { name: 'Default branch', exact: true })).toBeVisible();
});

Then('the project form lists Teams after Group and groups the Repository', async ({ page }) => {
  const projectForm = page.locator('form#bb-project-create-form:visible, form[id^="bb-project-settings-form"]:visible').first();
  await expect(projectForm).toBeVisible();
  const order = await projectForm.evaluate((element, fields) => fields
    .map((field) => ({ field, node: element.querySelector(`[data-drupal-selector="edit-${field}-wrapper"]`) }))
    .filter(({ node }) => node && (node as HTMLElement).offsetParent !== null)
    .sort((a, b) => (a.node!.compareDocumentPosition(b.node!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map(({ field }) => field), PROJECT_FIELD_ORDER);
  expect(order.slice(0, 2)).toEqual(['group-id', 'teams']);
  expect(order).toEqual(PROJECT_FIELD_ORDER.filter((field) => order.includes(field)));
  const repository = projectForm.getByRole('group', { name: 'Repository', exact: true });
  await expect(repository).toBeVisible();
  await expect(repository.getByRole('textbox', { name: 'URL', exact: true })).toBeVisible();
  await expect(repository.getByRole('textbox', { name: 'Default branch', exact: true })).toBeVisible();
});

Then('the project form offers Branch convention {string}', async ({ page }, offered: string) => {
  const projectForm = page.locator('form#bb-project-create-form:visible, form[id^="bb-project-settings-form"]:visible').first();
  const field = projectForm.getByRole('group', { name: 'Repository', exact: true }).getByRole('textbox', { name: 'Branch convention', exact: true });
  await expect(field).toHaveCount(offered === 'yes' ? 1 : 0);
});
