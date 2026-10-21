// Review flow on a disposable ticket: an assigned reviewer drafts in the review
// dialog, every visible review sits in the sidebar Reviews block as its author
// and its state widget, the current assignee accepts or rejects there, and
// readers see a review only once accepted. Ticket, assignment and any fixture review are drush
// writes; the reviews this flow creates are removed with the ticket.
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';

const { Given, When, Then, After } = createBdd(test);

const disposable = new WeakMap<Page, { ticket: string; url: string; marker?: string }>();
const refused = new WeakMap<Page, number>();
const visited = new WeakMap<Page, number>();

function subject(page: Page) {
  const found = disposable.get(page);
  if (!found) throw new Error('No disposable review ticket was created in this scenario.');
  return found;
}

const uidOf = (name: string): string =>
  `current(\\Drupal::entityTypeManager()->getStorage("user")->loadByProperties(["name" => "${safe(name)}"]))->id()`;

Given('a disposable review ticket assigned to {string} with reviewer {string}', async ({ page }, assignee: string, reviewer: string) => {
  const output = php([
    '$etm = \\Drupal::entityTypeManager();',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "bakers.build"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    `$t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => "Review flow ${Date.now()}", "workflow" => "bb_feature", "state" => "coding", "assignee_user_id" => ${uidOf(assignee)}, "reviewers" => [${uidOf(reviewer)}]]);`,
    '$t->save();',
    'print $t->uuid() . "|" . $t->toUrl()->toString();',
  ].join(' ')).split('\n').pop() ?? '';
  const [ticket, url] = output.split('|');
  if (!ticket || !url) throw new Error(`The disposable review ticket did not settle: "${output}".`);
  disposable.set(page, { ticket, url });
});

// markdown-authoring reuses the disposable review ticket, so it is cleaned up there too.
After({ tags: '@feature:review-flow or @feature:markdown-authoring' }, async ({ page }) => {
  const uuid = disposable.get(page)?.ticket;
  disposable.delete(page);
  if (!uuid) return;
  php([
    '$etm = \\Drupal::entityTypeManager();',
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${uuid}");`,
    'if (!$t) { return; }',
    '$c = $etm->getStorage("bb_comment"); $c->delete($c->loadByProperties(["ticket_id" => $t->id()]));',
    '$t->delete();',
  ].join(' '));
});

Given('{string} submitted the review {string}', async ({ page }, author: string, body: string) => {
  const { ticket } = subject(page);
  const output = php([
    `$u = \\Drupal::entityTypeManager()->getStorage("user")->load(${uidOf(author)});`,
    '\\Drupal::service("account_switcher")->switchTo($u);',
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    '$s = \\Drupal::entityTypeManager()->getStorage("bb_comment");',
    `$r = $s->create(["bundle" => "review", "ticket_id" => $t->id(), "author" => $u->id(), "type" => "comment", "body" => ["value" => "${safe(body)}", "format" => "bb_rich"]]);`,
    '$r->save(); $r = $s->loadUnchanged($r->id());',
    '$r->get("review_state")->first()->applyTransitionById("submit"); $r->save();',
    'print $r->get("review_state")->value;',
  ].join(' ')).split('\n').pop();
  expect(output).toBe('submitted');
});

When('I visit the disposable review ticket', async ({ page }) => {
  const response = await page.goto(subject(page).url);
  visited.set(page, response?.status() ?? 0);
});

/** The ticket page actually rendered for this reader, so an absence means something. */
async function expectRenderedTicket(page: Page) {
  expect(visited.get(page)).toBe(200);
  await expect(page.locator('[data-canvas-region="inspector"]').getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
}

const dialog = (page: Page) => page.locator('#bakers-overlay dialog');
const reviewsBlock = (page: Page) => page.locator('[data-canvas-region="inspector"] section')
  .filter({ has: page.getByRole('heading', { name: 'Reviews', exact: true }) });
const reviewBy = (page: Page, author: string) => reviewsBlock(page).locator('[data-bakers-review]', { hasText: author });

async function fillAndPress(page: Page, body: string, button: string) {
  await expect(dialog(page)).toBeVisible();
  const field = dialog(page).locator('textarea[name="body[0][value]"]');
  await field.fill(body);
  // A saved review answers with HX-Location: htmx swaps the ticket page in,
  // which removes the dialog. The steps after this one wait on that.
  await dialog(page).getByRole('button', { name: button, exact: true }).click();
}

When('I write the review {string} and save it as a draft', async ({ page }, body: string) => {
  await reviewsBlock(page).getByRole('link', { name: 'Write a review', exact: true }).click();
  await fillAndPress(page, body, 'Save draft');
});

When('I start writing a review', async ({ page }) => {
  await reviewsBlock(page).getByRole('link', { name: 'Write a review', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
});

// The review form of a submitted review, where its assignee decides it.
When('I open the review by {string} in its review form', async ({ page }, author: string) => {
  const { ticket } = subject(page);
  const path = php([
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    `$ids = \\Drupal::entityQuery("bb_comment")->accessCheck(FALSE)->condition("bundle", "review")->condition("ticket_id", $t->id())->condition("author", ${uidOf(author)})->execute();`,
    'print $ids ? \\Drupal\\Core\\Url::fromRoute("entity.bb_comment.review_form", ["bb_comment" => reset($ids)])->toString() : "";',
  ].join(' ')).split('\n').pop() ?? '';
  expect(path, `No review by ${author} on the disposable ticket`).not.toBe('');
  expect((await page.goto(path))?.status()).toBe(200);
});

When('I change my draft review to {string} and submit it', async ({ page }, body: string) => {
  await page.locator('[data-bakers-review="draft"]').getByRole('link', { name: 'Edit draft', exact: true }).click();
  await fillAndPress(page, body, 'Submit review');
});

Then('the review dialog is closed', async ({ page }) => {
  await expect(dialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${subject(page).url}$`));
});

Then('the Reviews block sits above Properties', async ({ page }) => {
  const inspector = page.locator('[data-canvas-region="inspector"]');
  const reviews = inspector.getByRole('heading', { name: 'Reviews', exact: true });
  const properties = inspector.getByRole('heading', { name: 'Properties', exact: true });
  await expect(reviews).toBeVisible();
  await expect(properties).toBeVisible();
  const [above, below] = [await reviews.boundingBox(), await properties.boundingBox()];
  expect(above!.y).toBeLessThan(below!.y);
});

Then('no review surface is left in the main column', async ({ page }) => {
  const main = page.locator('[data-canvas-region="main"]');
  await expect(main).toHaveCount(1);
  await expect(main.locator('[data-bakers-review]')).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Write a review', exact: true })).toHaveCount(0);
});

Then('I see no Reviews block', async ({ page }) => {
  await expectRenderedTicket(page);
  await expect(page.getByRole('heading', { name: 'Reviews', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-bakers-review]')).toHaveCount(0);
});

async function expectEntry(page: Page, state: string, author: string, offered: string[]) {
  const entry = reviewBy(page, author);
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute('data-bakers-review', state.toLowerCase());
  await expect(entry).toContainText(state);
  await expect(entry.getByRole('button')).toHaveText(offered);
}

Then('the Reviews block lists a {string} review by {string} offering {string}', async ({ page }, state: string, author: string, offered: string) => {
  await expectEntry(page, state, author, offered.split(',').map((label) => label.trim()));
});

Then('the Reviews block lists a {string} review by {string} offering nothing', async ({ page }, state: string, author: string) => {
  await expectEntry(page, state, author, []);
});

Then('the review by {string} offers no edit', async ({ page }, author: string) => {
  await expect(reviewBy(page, author).getByRole('link', { name: 'Edit draft' })).toHaveCount(0);
});

When('I press {string} on the review by {string}', async ({ page }, action: string, author: string) => {
  await reviewBy(page, author).getByRole('button', { name: action, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${subject(page).url}$`));
  await expect(reviewBy(page, author).getByRole('button', { name: action, exact: true })).toHaveCount(0);
});

Then('I do not see the review {string}', async ({ page }, text: string) => {
  await expectRenderedTicket(page);
  await expect(page.locator('body')).not.toContainText(text);
});

Then('the disposable review ticket answers {int} without the review {string}', async ({ page }, status: number, text: string) => {
  expect(visited.get(page)).toBe(status);
  await expect(page.locator('[data-bakers-review]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(text);
});

Then('the handoff stream shows the review {string}', async ({ page }, text: string) => {
  await expect(page.locator('[data-canvas-region="main"] details', { hasText: text })).toHaveCount(1);
});

Then('I am not offered {string}', async ({ page }, label: string) => {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
});

Then('I am offered {string}', async ({ page }, label: string) => {
  await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
});

Then('I am offered {string} without leaving the page', async ({ page }, label: string) => {
  await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${subject(page).url}$`));
});

Then('the Properties block offers no Save', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
  await expect(page.locator('form[data-form-save]')).toHaveCount(0);
});

When('{string} tries to clear the reviewers of the disposable review ticket over JSON:API', async ({ page, apiClient }, account: string) => {
  const { ticket } = subject(page);
  await apiClient.identify(account);
  await apiClient.send('PATCH', `/jsonapi/bb_ticket/bb_ticket/${ticket}`, JSON.stringify({
    data: { type: 'bb_ticket--bb_ticket', id: ticket, relationships: { reviewers: { data: [] } } },
  }));
  refused.set(page, apiClient.response!.status());
});

Then('that write is refused with status {int}', async ({ page }, status: number) => {
  expect(refused.get(page)).toBe(status);
});

Then('the disposable review ticket still has the reviewer {string}', async ({ page }, name: string) => {
  const names = php([
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${subject(page).ticket}");`,
    'print implode(",", array_map(fn($u) => $u->getAccountName(), $t->get("reviewers")->referencedEntities()));',
  ].join(' ')).split('\n').pop();
  expect(names?.split(',')).toContain(name);
});
