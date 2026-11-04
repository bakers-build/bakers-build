// Disposable entities of every deletable type, created through drush.
// Registers no steps: entity-delete.steps.ts consumes it.

// Northside and its `BB` project.
const PRELUDE = [
  '$etm = \\Drupal::entityTypeManager();',
  '$w = current($etm->getStorage("bb_workspace")->loadByProperties(["slug" => "bakers"]));',
  '$slug = $w->getSlug();',
  '$p = current($etm->getStorage("bb_project")->loadByProperties(["key" => "BB"]));',
].join(' ');

// Per kind: creates `$e` (the subject) and `$extra` (helpers), sets `$manage` and `$delete`.
export const KINDS: Record<string, string> = {
  project: '$e = $etm->getStorage("bb_project")->create(["name" => $l, "key" => "D" . substr($n, -7), "group_id" => $p->get("group_id")->target_id, "teams" => $p->get("teams")->getValue()]); $e->save(); $manage = $e->toUrl()->toString() . "/settings";',
  'busy project': '$e = $etm->getStorage("bb_project")->create(["name" => $l, "key" => "D" . substr($n, -7), "group_id" => $p->get("group_id")->target_id, "teams" => $p->get("teams")->getValue()]); $e->save(); $t = $etm->getStorage("bb_ticket")->create(["project_id" => $e->id(), "title" => $l, "workflow" => "bb_work"]); $t->save(); $extra[] = $t; $manage = $e->toUrl()->toString() . "/settings";',
  team: '$e = $etm->getStorage("bb_team")->create(["name" => $l, "workspace_id" => $w->id()]); $e->save(); $manage = $e->toUrl()->toString();',
  group: '$e = $etm->getStorage("bb_group")->create(["name" => $l, "workspace_id" => $w->id()]); $e->save(); $manage = $e->toUrl()->toString() . "/settings";',
  environment: '$e = $etm->getStorage("bb_environment")->create(["name" => $l, "project_id" => $p->id()]); $e->save(); $manage = $e->toUrl("edit-form")->toString();',
  label: '$e = $etm->getStorage("bb_term")->create(["vid" => "label", "name" => $l, "workspace_id" => $w->id()]); $e->save(); $t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => $l, "workflow" => "bb_work", "labels" => [$e->id()]]); $t->save(); $extra[] = $t; $manage = "/$slug/settings/labels"; $delete = "/$slug/term/" . $e->id() . "/delete";',
  template: '$e = $etm->getStorage("bb_ticket_template")->create(["name" => $l, "workspace_id" => $w->id(), "enabled" => TRUE, "title_pattern" => $l, "workflow" => "bb_work", "target_state" => "qualification"]); $e->save(); $manage = $e->toUrl("edit-form")->toString();',
  trigger: '$tp = $etm->getStorage("bb_ticket_template")->create(["name" => $l, "workspace_id" => $w->id(), "enabled" => TRUE, "title_pattern" => $l, "workflow" => "bb_work", "target_state" => "qualification"]); $tp->save(); $extra[] = $tp; $e = $etm->getStorage("bb_ticket_trigger")->create(["bundle" => "template", "workspace_id" => $w->id(), "template_id" => $tp->id(), "trigger_type" => ["plugin_id" => "schedule", "plugin_configuration" => ["frequency" => "monthly", "day" => "1", "time" => "09:00", "timezone" => "Europe/Berlin"]], "enabled" => FALSE]); $e->save(); $manage = \\Drupal\\Core\\Url::fromRoute("view.bb_ticket_triggers.template_list", $tp->toUrl()->getRouteParameters())->toString();',
  ticket: '$e = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => $l, "workflow" => "bb_work"]); $e->save(); $c = $etm->getStorage("bb_comment")->create(["ticket_id" => $e->id(), "body" => ["value" => $l, "format" => "bb_rich"]]); $c->save(); $extra[] = $c; $manage = $e->toUrl("edit-form")->toString();',
  comment: '$t = $etm->getStorage("bb_ticket")->create(["project_id" => $p->id(), "title" => $l, "workflow" => "bb_work"]); $t->save(); $e = $etm->getStorage("bb_comment")->create(["ticket_id" => $t->id(), "body" => ["value" => $l, "format" => "bb_rich"]]); $e->save(); $extra[] = $t; $manage = $t->toUrl()->toString();',
  invite: '$e = $etm->getStorage("bb_invite")->create(["email" => "delete-" . $n . "@example.com", "workspace_id" => $w->id()]); $e->save(); $manage = "/$slug/settings/members"; $delete = "/$slug/invite/" . $e->id() . "/delete";',
  machine: '$admin = current($etm->getStorage("user")->loadByProperties(["name" => "site-admin"])); $e = $etm->getStorage("bb_machine")->create(["name" => $l, "host_key" => "delete-" . $n, "owner_user_id" => $admin->id()]); $e->save(); $manage = $e->toUrl()->toString();',
  conductor: '$e = $etm->getStorage("bb_conductor")->create(["label" => $l, "conductor_id" => "delete-" . $n, "project_id" => $p->id()]); $e->save(); $manage = $e->toUrl()->toString();',
  workspace: '$e = $etm->getStorage("bb_workspace")->create(["name" => $l, "slug" => "delete-" . $n]); $e->save(); $manage = "/delete-$n/settings";',
};

/**
 * The PHP that creates a disposable entity of the kind.
 *
 * It prints "type:id[,type:id…]|label|managing path|delete path", the subject
 * first, then the helpers it needed.
 */
export function disposableSnippet(kind: string, n: string): string {
  const create = KINDS[kind];
  if (!create) throw new Error(`No disposable kind "${kind}".`);
  return [
    PRELUDE,
    `$n = "${n}"; $l = "Delete me ${kind} ${n}"; $extra = []; $delete = NULL;`,
    create,
    '$delete = $delete ?? $e->toUrl("delete-form")->toString();',
    '$created = array_merge([$e->getEntityTypeId() . ":" . $e->id()], array_map(fn($x) => $x->getEntityTypeId() . ":" . $x->id(), $extra));',
    '$label = $e->label() ?: $e->getEntityType()->getSingularLabel();',
    'print implode(",", $created) . "|" . $label . "|" . $manage . "|" . $delete;',
  ].join(' ');
}
