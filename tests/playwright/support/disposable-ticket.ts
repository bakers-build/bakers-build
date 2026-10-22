// Disposable ticket (+ optional running run) shared by intervention and
// canonical-run scenarios so a second WeakMap cannot drift from the first.
import type { Page } from '@playwright/test';
import { php } from './drush';

export type DisposableTicket = {
  ticket: string;
  url: string;
  title: string;
  identifier: string;
  run?: string;
  runId?: string;
};

const disposable = new WeakMap<Page, DisposableTicket>();

/** Last line of a drush ev snippet; Drupal often prints notices above it. */
export function lastLine(snippet: string): string {
  return php(snippet).split('\n').pop()?.trim() ?? '';
}

export function subject(page: Page): DisposableTicket {
  const found = disposable.get(page);
  if (!found) {
    throw new Error('No disposable ticket was created in this scenario.');
  }
  return found;
}

export function createDisposableTicket(
  page: Page,
  workflow: string,
  state: string,
  withRun: boolean,
): DisposableTicket {
  const title = `Intervention ${workflow} ${state} ${Date.now()}`;
  const output = lastLine([
    '$etm = \\Drupal::entityTypeManager();',
    '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
    'if (!$p) { print "NO_PROJECT"; return; }',
    `$t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => "${title}", "workflow" => "${workflow}", "state" => "${state}"]);`,
    '$t->save();',
    '$runUuid = ""; $runId = "";',
    withRun
      ? '$c = current($etm->getStorage("bb_conductor")->loadMultiple()); if (!$c) { print "NO_CONDUCTOR"; return; } $r = $etm->getStorage("bb_run")->create(["ticket_id" => $t->id(), "conductor_id" => $c->id(), "state" => "running", "state_at_start" => "coding", "started_at" => time()]); $r->save(); $runUuid = $r->uuid(); $runId = $r->id();'
      : '',
    'print $t->uuid() . "|" . $t->toUrl()->toString() . "|" . $runUuid . "|" . $runId . "|" . $t->getIdentifier() . "|" . $t->label();',
  ].join(' '));
  const [ticket, url, run, runId, identifier, ticketTitle] = output.split('|');
  if (!ticket || !url) {
    throw new Error(`The disposable ticket fixture did not settle: "${output}".`);
  }
  const record: DisposableTicket = {
    ticket,
    url,
    title: ticketTitle || title,
    identifier: identifier || '',
    run: run || undefined,
    runId: runId || undefined,
  };
  disposable.set(page, record);
  return record;
}

export function deleteDisposableTicket(page: Page): void {
  const uuid = disposable.get(page)?.ticket;
  disposable.delete(page);
  if (!uuid) {
    return;
  }
  lastLine([
    `$t = \\Drupal::service("entity.repository")->loadEntityByUuid("bb_ticket", "${uuid}");`,
    'if ($t) { $t->delete(); }',
  ].join(' '));
}
