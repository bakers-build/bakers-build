// A project's identifier prefix changed on its Settings form: existing tickets
// keep their identifier, new ones use the new prefix, other projects' old
// prefixes stay reserved. Projects and tickets are disposable and deleted after
// each scenario. Consumer: features/projects/project-identifier-prefix.feature.
import { createBdd } from 'playwright-bdd';
import { test, expect } from '../../bdd.fixtures';
import { type Page } from '@playwright/test';
import { php } from '../../support/drush';

const { Given, When, Then, After } = createBdd(test);

const FORM = 'form[id^="bb-project-settings-form"]';
const PRELUDE = '$etm = \\Drupal::entityTypeManager(); $bb = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));';

/** The scenario's project, its first ticket and the prefixes in play. */
const state = { id: '', settings: '', prefix: '', next: '', ticketUrl: '', identifier: '', retired: '', projects: [] as string[] };

/** A prefix no project has used yet: a letter and five more characters. */
function freshPrefix(letter: string): string {
  return letter + Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0');
}

/** Creates a Northside project with one ticket; returns its id, settings path and ticket. */
function projectWithTicket(prefix: string): { id: string; settings: string; ticketUrl: string; identifier: string } {
  const created = JSON.parse(php(
    `${PRELUDE} $p = $etm->getStorage("bb_project")->create(["name" => "Prefix ${prefix}", "key" => "${prefix}", "group_id" => $bb->get("group_id")->target_id, "teams" => $bb->get("teams")->getValue()]); $p->save();` +
      ' $t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => "Prefix ticket", "workflow" => "bb_work"]); $t->save();' +
      ' print json_encode(["id" => $p->id(), "settings" => $p->toUrl()->toString() . "/settings", "ticketUrl" => $t->toUrl()->toString(), "identifier" => $t->getIdentifier()]);',
  ));
  state.projects.push(created.id);
  return created;
}

function storedPrefix(id: string): string {
  return php(`print \\Drupal::entityTypeManager()->getStorage("bb_project")->loadUnchanged(${Number(id)})->getKey();`);
}

async function savePrefix(page: Page, prefix: string): Promise<void> {
  const form = page.locator(FORM);
  await form.getByRole('textbox', { name: 'Identifier prefix', exact: true }).fill(prefix);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForLoadState('load');
}

After({ tags: '@feature:project-identifier-prefix' }, async () => {
  if (state.projects.length > 0) {
    php(
      '$etm = \\Drupal::entityTypeManager();' +
        ` $ids = [${state.projects.map(Number).join(', ')}];` +
        ' $etm->getStorage("bb_ticket")->delete($etm->getStorage("bb_ticket")->loadByProperties(["project_id" => $ids]));' +
        ' $etm->getStorage("bb_project")->delete($etm->getStorage("bb_project")->loadMultiple($ids));',
    );
  }
  Object.assign(state, { id: '', settings: '', prefix: '', next: '', ticketUrl: '', identifier: '', retired: '', projects: [] });
});

Given('a disposable project with one ticket', async () => {
  state.prefix = freshPrefix('P');
  Object.assign(state, projectWithTicket(state.prefix));
});

Given("another project's ticket carries a retired prefix", async () => {
  state.retired = freshPrefix('R');
  const other = projectWithTicket(state.retired);
  php(`$p = \\Drupal::entityTypeManager()->getStorage("bb_project")->load(${Number(other.id)}); $p->set("key", "${freshPrefix('S')}")->save();`);
});

When("I open the disposable project's settings", async ({ page }) => {
  expect((await page.goto(state.settings))?.status()).toBe(200);
  await expect(page.locator(FORM)).toBeVisible();
});

Then('the field "Identifier prefix" holds the project\'s prefix', async ({ page }) => {
  await expect(page.locator(FORM).getByRole('textbox', { name: 'Identifier prefix', exact: true })).toHaveValue(state.prefix);
  await expect(page.locator(FORM).getByText('only to tickets created afterwards')).toBeVisible();
});

When('I save the identifier prefix {string}', async ({ page }, prefix: string) => {
  await savePrefix(page, prefix);
});

When('I save the retired prefix', async ({ page }) => {
  await savePrefix(page, state.retired);
});

When('I save a new identifier prefix', async ({ page }) => {
  state.next = freshPrefix('N');
  await savePrefix(page, state.next);
});

Then('the form names the identifier prefix rule', async ({ page }) => {
  await expect(page.getByText('The identifier prefix must be 2–10 uppercase letters or digits, starting with a letter (e.g. BB).').first()).toBeVisible();
});

Then('the form says the retired prefix is reserved', async ({ page }) => {
  await expect(page.getByText(`The identifier prefix ${state.retired} is reserved: another project’s tickets use it.`).first()).toBeVisible();
});

Then("the project's prefix is unchanged", async () => {
  expect(storedPrefix(state.id)).toBe(state.prefix);
});

Then("the project's prefix is the new one", async () => {
  await expect.poll(() => storedPrefix(state.id)).toBe(state.next);
});

Then('the existing ticket still opens under its old identifier', async ({ page }) => {
  expect(state.identifier).toBe(`${state.prefix}-1`);
  expect((await page.goto(state.ticketUrl))?.status()).toBe(200);
  await expect(page.getByText(state.identifier).first()).toBeVisible();
});

Then('the next ticket of the project gets the new prefix and the next number', async () => {
  const identifier = php(
    `$t = \\Drupal::entityTypeManager()->getStorage("bb_ticket")->create(["project_id" => ${Number(state.id)}, "title" => "After the change", "workflow" => "bb_work"]); $t->save(); print $t->getIdentifier();`,
  );
  expect(identifier).toBe(`${state.next}-2`);
});

Then("the disposable project's settings refuse me", async ({ page }) => {
  const status = (await page.goto(state.settings))?.status() ?? 0;
  if (status === 200) {
    await expect(page.locator(FORM).getByRole('textbox', { name: 'Identifier prefix', exact: true })).toHaveCount(0);
  }
  else {
    expect(status).toBe(403);
  }
  expect(storedPrefix(state.id)).toBe(state.prefix);
});
