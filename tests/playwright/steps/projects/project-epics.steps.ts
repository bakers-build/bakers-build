// An epic with a closed child in a project, for the scenarios that filter a
// project's figures by epic. The scenario owns both tickets: they are created
// through drush and deleted after it, so no seeded fixture changes.
import { Given } from '@key-tec/playwright-core/bdd';
import { createBdd } from 'playwright-bdd';
import type { Page } from '@playwright/test';
import { test } from '../../bdd.fixtures';
import { lastLine } from '../../support/disposable-ticket';

const { After } = createBdd(test);

const created = new WeakMap<Page, string[]>();

After({ tags: '@feature:project-stats' }, async ({ page }) => {
  const uuids = created.get(page) ?? [];
  created.delete(page);
  if (uuids.length === 0) {
    return;
  }
  lastLine([
    '$repository = \\Drupal::service("entity.repository");',
    `foreach (${JSON.stringify(uuids)} as $uuid) { $repository->loadEntityByUuid("bb_ticket", $uuid)?->delete(); }`,
  ].join(' '));
});

Given(
  'the project {string} has the epic {string} with the closed child {string}',
  async ({ page }, project: string, epic: string, child: string) => {
    const output = lastLine([
      '$ts = \\Drupal::entityTypeManager()->getStorage("bb_ticket");',
      `$p = current(\\Drupal::entityTypeManager()->getStorage("bb_project")->loadByProperties(["name" => ${JSON.stringify(project)}]));`,
      'if (!$p) { print "NO_PROJECT"; return; }',
      '$ws = $p->get("group_id")->entity->get("workspace_id")->target_id; $tt = \\Drupal::entityTypeManager()->getStorage("bb_term");',
      '$t = current($tt->loadByProperties(["vid" => "type", "name" => "epic", "workspace_id" => $ws])) ?: $tt->create(["vid" => "type", "name" => "epic", "workspace_id" => $ws]); $t->save();',
      `$e = $ts->create(["project_id" => $p->id(), "title" => ${JSON.stringify(epic)}, "workflow" => "bb_work", "ticket_type" => $t->id()]);`,
      '$e->save();',
      `$c = $ts->create(["project_id" => $p->id(), "parent_id" => $e->id(), "title" => ${JSON.stringify(child)}, "workflow" => "bb_work", "closed" => TRUE, "closed_date" => time()]);`,
      '$c->save();',
      'print $e->uuid() . "|" . $c->uuid();',
    ].join(' '));
    const uuids = output.split('|');
    if (uuids.length !== 2 || uuids.some((uuid) => uuid === '')) {
      throw new Error(`The epic fixture did not settle: "${output}".`);
    }
    created.set(page, uuids);
  },
);
