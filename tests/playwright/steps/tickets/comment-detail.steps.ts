// Canonical comment page: fixture-owned comments on a disposable ticket.
import { Given, When, Then } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { markDocument } from '../../support/shell';
import {
  deleteDisposableTicket,
  lastLine,
  subject,
} from '../../support/disposable-ticket';

const { After } = createBdd(test);

type CommentRecord = {
  uuid: string;
  url: string;
  author: string;
  time: string;
};

const comments = new WeakMap<Page, Record<string, CommentRecord>>();
const foreignTickets = new WeakMap<Page, string>();

After({ tags: '@feature:comment-detail' }, async ({ page }) => {
  const owned = comments.get(page) ?? {};
  comments.delete(page);
  const uuids = Object.values(owned).map((record) => record.uuid);
  const foreign = foreignTickets.get(page);
  foreignTickets.delete(page);
  if (uuids.length > 0) {
    lastLine(
      '$repo = \\Drupal::service("entity.repository"); foreach (["' +
        uuids.join('","') +
        '"] as $uuid) { $c = $repo->loadEntityByUuid("bb_comment", $uuid); if ($c) { $c->delete(); } } print "ok";',
    );
  }
  if (foreign) {
    lastLine(
      `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${foreign}"); if ($t) { $t->delete(); } print "ok";`,
    );
  }
  deleteDisposableTicket(page);
});

function remember(page: Page, key: string, record: CommentRecord): void {
  comments.set(page, { ...(comments.get(page) ?? {}), [key]: record });
}

function record(page: Page, key: string): CommentRecord {
  const found = comments.get(page)?.[key];
  if (!found) {
    throw new Error(`No fixture comment "${key}" was created in this scenario.`);
  }
  return found;
}

function createComment(
  page: Page,
  type: string,
  body: string,
  created?: number,
): CommentRecord {
  const { ticket } = subject(page);
  const createdPhp = created === undefined ? '' : `$c->setCreatedTime(${created});`;
  const output = lastLine([
    '$etm = \\Drupal::entityTypeManager();',
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    '$u = current($etm->getStorage("user")->loadByProperties(["name" => "cwiedemann"]));',
    'if (!$t || !$u) { print "NO_HOST"; return; }',
    `$c = $etm->getStorage("bb_comment")->create(["ticket_id" => $t->id(), "author" => $u->id(), "type" => "${type}", "body" => ["value" => "${body}", "format" => "bb_rich"]]);`,
    createdPhp,
    '$c->save();',
    '$name = ($u->hasField("field_full_name") && $u->get("field_full_name")->value) ? (string) $u->get("field_full_name")->value : (string) $u->label();',
    '$when = \\Drupal::service("date.formatter")->format($c->getCreatedTime(), "normal", "", $u->getTimeZone());',
    'print $c->uuid() . "|" . $c->toUrl()->toString() . "|" . $name . "|" . $when;',
  ].join(' '));
  const [uuid, url, author, time] = output.split('|');
  if (!uuid || !url) {
    throw new Error(`The comment fixture did not settle: "${output}".`);
  }
  const saved = { uuid, url, author: author || '', time: time || '' };
  remember(page, type, saved);
  return saved;
}

Given(
  'the disposable ticket has a spec handoff whose body contains a table and {string}',
  async ({ page }, marker: string) => {
    createComment(
      page,
      'spec',
      `| Col | Val |\\n| --- | --- |\\n| Cell | ${marker} |\\n\\nSpec handoff.\\n\\n${marker}`,
    );
  },
);

Given(
  'the disposable ticket has older spec, current plan and newer test comments',
  async ({ page }) => {
    createComment(page, 'spec', 'OLDER-SPEC-BODY', 100);
    createComment(page, 'plan', 'CURRENT-PLAN-BODY', 200);
    createComment(page, 'test', 'NEWER-TEST-BODY', 300);
  },
);

Given('another ticket has a comment between those times', async ({ page }) => {
  const { ticket } = subject(page);
  const output = lastLine([
    '$etm = \\Drupal::entityTypeManager();',
    `$home = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
    '$p = $home ? $home->get("project_id")->entity : NULL;',
    '$u = current($etm->getStorage("user")->loadByProperties(["name" => "cwiedemann"]));',
    'if (!$p || !$u) { print "NO_FOREIGN"; return; }',
    '$f = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => "Foreign comment host", "workflow" => "bb_feature", "state" => "coding"]);',
    '$f->save();',
    '$c = $etm->getStorage("bb_comment")->create(["ticket_id" => $f->id(), "author" => $u->id(), "type" => "spec", "body" => ["value" => "FOREIGN-COMMENT-BODY", "format" => "bb_rich"]]);',
    '$c->setCreatedTime(150);',
    '$c->save();',
    'print $f->uuid() . "|" . $c->uuid();',
  ].join(' '));
  const [foreign, commentUuid] = output.split('|');
  if (!foreign || !commentUuid) {
    throw new Error(`The foreign comment fixture did not settle: "${output}".`);
  }
  foreignTickets.set(page, foreign);
  remember(page, 'foreign', { uuid: commentUuid, url: '', author: '', time: '' });
});

Given(
  'the disposable ticket has a 32 KiB handoff-v3 body ending with {string}',
  async ({ page }, marker: string) => {
    const { ticket } = subject(page);
    const output = lastLine([
      '$etm = \\Drupal::entityTypeManager();',
      `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${ticket}");`,
      '$u = current($etm->getStorage("user")->loadByProperties(["name" => "cwiedemann"]));',
      'if (!$t || !$u) { print "NO_HOST"; return; }',
      `$body = "| H | V |\\n| --- | --- |\\n| Wide | Cell |\\n\\n" . str_repeat("x", 32768) . "\\n\\n${marker}";`,
      '$c = $etm->getStorage("bb_comment")->create(["ticket_id" => $t->id(), "author" => $u->id(), "type" => "handoff-v3", "body" => ["value" => $body, "format" => "bb_rich"]]);',
      '$c->save();',
      '$name = ($u->hasField("field_full_name") && $u->get("field_full_name")->value) ? (string) $u->get("field_full_name")->value : (string) $u->label();',
      '$when = \\Drupal::service("date.formatter")->format($c->getCreatedTime(), "normal", "", $u->getTimeZone());',
      'print $c->uuid() . "|" . $c->toUrl()->toString() . "|" . $name . "|" . $when;',
    ].join(' '));
    const [uuid, url, author, time] = output.split('|');
    if (!uuid || !url) {
      throw new Error(`The long comment fixture did not settle: "${output}".`);
    }
    remember(page, 'handoff-v3', { uuid, url, author: author || '', time: time || '' });
  },
);

When('I visit the current comment', async ({ page }) => {
  await page.goto(record(page, 'plan').url);
  await markDocument(page);
});

When('I visit that long comment', async ({ page }) => {
  await page.goto(record(page, 'handoff-v3').url);
  await markDocument(page);
});

When('I open the disposable ticket identifier', async ({ page }) => {
  const { identifier } = subject(page);
  await page.getByRole('link', { name: identifier, exact: true }).first().click();
});

When('I open the comment link {string}', async ({ page }, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('link', { name: new RegExp('^' + escaped) }).first().click();
});

Then('the page shows a table cell {string}', async ({ page }, text: string) => {
  await expect(page.locator('td', { hasText: text }).first()).toBeVisible();
});

Then('the page shows the comment author', async ({ page }) => {
  const author = comments.get(page)?.spec?.author
    ?? comments.get(page)?.plan?.author
    ?? comments.get(page)?.['handoff-v3']?.author
    ?? '';
  expect(author).not.toBe('');
  await expect(page.getByText(author, { exact: true }).first()).toBeVisible();
});

Then('the page shows the comment time', async ({ page }) => {
  const time = comments.get(page)?.spec?.time
    ?? comments.get(page)?.plan?.time
    ?? comments.get(page)?.['handoff-v3']?.time
    ?? '';
  expect(time).not.toBe('');
  await expect(page.getByText(time, { exact: true }).first()).toBeVisible();
});

Then('the page shows the disposable ticket identifier', async ({ page }) => {
  const { identifier } = subject(page);
  await expect(page.getByText(identifier, { exact: true }).first()).toBeVisible();
});
