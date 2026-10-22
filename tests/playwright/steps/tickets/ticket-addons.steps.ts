// The ticket's inline Addons card (BB-661): a reviewer sends the Ports
// addon's single `tunnel` message, a simulated conductor answers the inbox
// message, and the card shows the Markdown result — only to the requester who
// sent it. The conductor and its addon are drush fixtures on a disposable
// ticket, so no seeded fixture changes and the feature stays re-runnable.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { php } from '../../support/drush';
import { safe } from '../../support/listing';

const { After } = createBdd(test);

/** The addon version this feature registers; never a real ports release. */
const VERSION = '0.0.0-e2e';

const PORTS_DEFINITION = {
  name: 'ports',
  version: VERSION,
  contract: 2,
  label: 'Ports',
  messages: {
    tunnel: { label: 'Share tunnels', access: 'view' },
  },
};

const disposable = new WeakMap<Page, { ticket: string; url: string; conductor?: string }>();

function subject(page: Page) {
  const found = disposable.get(page);
  if (!found) throw new Error('No disposable addons ticket was created in this scenario.');
  return found;
}

/** A PHP string literal holding JSON; the JSON carries no double quote escaping issue for drush. */
function jsonLiteral(value: unknown): string {
  return `base64_decode("${Buffer.from(JSON.stringify(value)).toString('base64')}")`;
}

async function createTicket(page: Page, withConductor: boolean): Promise<void> {
  const title = `Addons ${withConductor ? 'with' : 'without'} conductor ${Date.now()}`;
  const output = php([
    '$etm = \\Drupal::entityTypeManager();',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    `$t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => "${title}", "workflow" => "bb_feature", "state" => "coding"]);`,
    '$c = NULL;',
    withConductor
      ? '$c = current($etm->getStorage("bb_conductor")->loadByProperties(["project_id" => $p->id()])); if (!$c) { print "NO_CONDUCTOR"; return; } $t->set("conductor_id", $c->id());'
      : '',
    '$t->save();',
    withConductor
      ? [
          '$ws = NULL;',
          '$proj = $etm->getStorage("bb_project")->load($c->get("project_id")->target_id);',
          '$group = $proj?->getGroup(); $ws = $group?->getWorkspace();',
          'if (!$ws) { print "NO_WORKSPACE"; return; }',
          `$def = ${jsonLiteral(PORTS_DEFINITION)};`,
          `$s = $etm->getStorage("bb_addon"); $a = current($s->loadByProperties(["workspace_id" => $ws->id(), "name" => "ports", "version" => "${VERSION}"]));`,
          'if (!$a) { $a = $s->create(["workspace_id" => $ws->id(), "name" => "ports", "version" => "' + VERSION + '", "contract" => 2, "definition" => $def]); }',
          '$a->addConductor($c)->save();',
        ].join(' ')
      : '',
    'print $t->uuid() . "|" . $t->toUrl()->toString() . "|" . ($c ? $c->id() : "");',
  ].join(' '));
  if (!output.includes('|')) throw new Error(`The disposable addons ticket did not settle: "${output}".`);
  const [ticket, url, conductor] = output.split('\n').pop()!.split('|');
  disposable.set(page, { ticket, url, conductor: conductor || undefined });
}

/** Answers the newest pending message of the ticket as the conductor would. */
function answer(page: Page, messageId: string, markdown: string): void {
  const { ticket } = subject(page);
  const out = php([
    '$etm = \\Drupal::entityTypeManager();',
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    '$s = $etm->getStorage("bb_inbox_message");',
    `$ids = $s->getQuery()->accessCheck(FALSE)->condition("ticket_id", $t->id())->condition("message_id", "${safe(messageId)}")->condition("status", "pending")->sort("id", "DESC")->range(0, 1)->execute();`,
    'if (!$ids) { print "NO_MESSAGE"; return; }',
    '$m = $s->load(reset($ids));',
    `$m->setResult("done", ["markdown" => "${safe(markdown)}"]);`,
    '$v = $m->validate(); if (count($v)) { print "INVALID " . $v[0]->getMessage(); return; }',
    '$m->save(); print "OK";',
  ].join(' '));
  if (!out.endsWith('OK')) throw new Error(`The conductor could not answer ${messageId}: "${out}".`);
}

After({ tags: '@feature:ticket-addons' }, async ({ page }) => {
  const uuid = disposable.get(page)?.ticket;
  disposable.delete(page);
  if (!uuid) return;
  php([
    '$etm = \\Drupal::entityTypeManager();',
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${uuid}");`,
    'if (!$t) { return; }',
    'foreach (["bb_inbox_message"] as $type) { $s = $etm->getStorage($type); $s->delete($s->loadByProperties(["ticket_id" => $t->id()])); }',
    '$t->delete();',
  ].join(' '));
});

Given('a disposable addons ticket without conductor', async ({ page }) => {
  await createTicket(page, false);
});

Given('a disposable addons ticket whose conductor runs the ports addon', async ({ page }) => {
  await createTicket(page, true);
});

const card = (page: Page) => page.locator('[data-addons-card]');

When('I visit the disposable addons ticket', async ({ page }) => {
  await page.goto(subject(page).url);
  // The shared conductor can run other addons (the overview probe), whose tab
  // may come first; every assertion here is about Ports.
  const ports = card(page).getByRole('link', { name: 'Ports', exact: true });
  if ((await ports.count()) > 0) {
    await ports.click();
    await expect(card(page).getByRole('link', { name: 'Share tunnels', exact: true })).toBeVisible();
  }
});

Then('I do not see the addons card', async ({ page }) => {
  await expect(card(page)).toHaveCount(0);
});

Then('the addons card offers {string}', async ({ page }, name: string) => {
  await expect(card(page).getByRole('link', { name, exact: true })).toBeVisible();
});

When('I click {string} in the addons card', async ({ page }, name: string) => {
  await card(page).getByRole('link', { name, exact: true }).click();
});

/** The payload of the newest pending message of that id, or NONE. */
function pendingExists(page: Page, messageId: string): string | undefined {
  const { ticket } = subject(page);
  return php([
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    `$ids = \\Drupal::entityTypeManager()->getStorage("bb_inbox_message")->getQuery()->accessCheck(FALSE)->condition("ticket_id", $t->id())->condition("message_id", "${safe(messageId)}")->condition("status", "pending")->execute();`,
    'print $ids ? "YES" : "NONE";',
  ].join(' ')).split('\n').pop();
}

Then('a pending {string} message exists', async ({ page }, messageId: string) => {
  await expect.poll(() => pendingExists(page, messageId)).toBe('YES');
});

When('the conductor answers it with the shared URL {string}', async ({ page }, url: string) => {
  answer(page, 'ports.tunnel', `- [${url}](${url})`);
});

Then('the addons card shows the link {string}', async ({ page }, url: string) => {
  // The card polls every 3 s while the message is open; the answer lands on the next poll.
  await expect(card(page).locator(`a[href="${url}"]`).first()).toBeVisible({ timeout: 10_000 });
});

Then('I do not see the link {string}', async ({ page }, url: string) => {
  await expect(page.locator(`a[href="${url}"]`)).toHaveCount(0);
});

Then('the addons card shows {string}', async ({ page }, text: string) => {
  await expect(card(page)).toContainText(text);
});
