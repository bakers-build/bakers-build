---
title: Web UI sitemap
description: >-
  The route, gate and tab-position tables that WebUiSitemapStructureTest
  reads, one per nav place, with the reasoning split into parts.
---

# Web UI sitemap

**This file is a test fixture, not prose.**
`Drupal\Tests\bb_core\Kernel\WebUiSitemapStructureTest` (BB-454) reads it
directly and, for each row below, requests the route once per rank — workspace
lead, workspace contributor, workspace guest, non-member — asserting that the
response status matches the declared gate, that a tab row (where one applies)
carries the row in its declared position, and that the response raises no PHP
error or warning. It is a Kernel test rather than a browser one: a real request
over `SIMPLETEST_BASE_URL` would hit the web server's own separate `:memory:`
SQLite database, never this test's fixtures — the class's own docblock measures
why. The file and the routing are asserted to agree in **both** directions, from
a **live** enumeration of `router.route_provider` rather than a fixed list of
the routes this ticket happened to add: a route declared here but absent from
routing fails the test, and a product route under `/_workspace/` present in
routing but absent from here fails it too — every CRUD form route and the
canonical route of an entity type with no nav home of its own (see below) are
excluded from that reverse check, not silently passed. Edit this file when the
structure changes; a stale row is a red test, not stale documentation.

Every place is deliberately **empty** as of BB-454 — the scaffold gives each
place a route, a gate and, where it has one, a tab position. Filling a place
with real content is a named follow-up, created after this ticket merges.

## Rail

| Place | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| My work | `view.tickets.my_work` | `/{ws}/tickets` | View (page display) | workspace membership | `_bb_workspace_match` (the display delegates: `access: type: none`) |
| My work › Stats | `bb_core.my_work.stats` | `/{ws}/stats` | Controller | authenticated | `_user_is_logged_in` (BB-481; a user's own figures are always disclosed to them, so this route adds no permission of its own and the figures still filter themselves) |
| Groups | `view.groups.workspace_list` | `/{ws}/groups` | View (page display) | `view bb_group` | `_permission` (the display's own access) |
| Projects | `view.projects.workspace_list` | `/{ws}/projects` | View (page display) | `view bb_project` | `_permission` (the display's own access) |
| Insights | `bb_core.workspace.insights` | `/{ws}/insights` | Controller | `view bakers figure workspace_overview` in this workspace (workspace lead) | `_bb_workspace_permission` (the workspace figures, all projects of the workspace; contributors, members and guests are refused, an outsider meets the workspace boundary's 404) |
| Settings | `bb_core.bb_workspace.settings` | `/{ws}/settings` | Controller | `bb_workspace.update` (→ `update any bb_workspace`) | `_entity_access` |
| Teams | `entity.bb_team.canonical` (one row per team) | `/{ws}/team/{id}` | — (rows added by `BbMenuSource` under the Teams heading) | `bb_team.view` | An `accessCheck(TRUE)` team query, scoped to the ambient workspace |

## Workspace settings — seven tabs, Settings default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Settings (default) | `bb_core.bb_workspace.settings` | `/{ws}/settings` | Entity form | `bb_workspace.update` | `_entity_access` |
| Members | `bb_core.bb_workspace.members` | `/{ws}/settings/members` | Controller (island) | `bb_workspace.update` | `_entity_access` |
| Addons | `view.addons.settings` | `/{ws}/settings/addons` | View (page display) | `bb_workspace.update` | `_entity_access`, set on the Views route by `BbWorkspaceRouteSubscriber` (the display's own access is `none`) |
| Templates | `view.bb_ticket_templates.workspace_list` | `/{ws}/settings/templates` | View (page display) | `view bb_ticket_template` in this workspace | `_bb_workspace_permission` instead of its sibling tabs' lead gate, so contributors may list and use workspace templates and a guest may not, whatever rank it holds elsewhere; they see no Settings entry and reach the tab by its address. Lists the workspace templates of this workspace only. Its *Add template* header action opens `entity.bb_ticket_template.add_for_workspace`, gated by `_bb_workspace_create` (the create right in this workspace); its optional project makes a project template. |
| Types | `view.bb_terms.types` | `/{ws}/settings/types` | View (page display) | `bb_workspace.update` | `_entity_access`, set on the Views route by `BbWorkspaceRouteSubscriber` (the display's own access is `view bb_term`). Lists the `type` terms of this workspace. |
| Recipes | `view.bb_terms.recipes` | `/{ws}/settings/recipes` | View (page display) | `bb_workspace.update` | As Types, for the `recipe` terms. |
| Labels | `view.bb_terms.labels` | `/{ws}/settings/labels` | View (page display) | `bb_workspace.update` | As Types, for the `label` terms. |

The `bb_api_key` submodule adds a further tab, **Service accounts**
(`view.bb_service_accounts.settings`, `/{ws}/settings/service-accounts`), when
it is enabled; see service accounts.

## Workspace invitation — a dialog, not a tab

The **Invite members** button in the Members zone opens a dialog on its own
route. It is not a tab, so it has its own table rather than a row in the tab
table above.

| Place | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Invite members | `bb_core.workspace_invite` | `/{ws}/invite` | Form (island dialog) | `bb_workspace.update` | `_entity_access` |

## Project detail — eight tabs, Overview default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Overview (default) | `entity.bb_project.canonical` | `/{ws}/project/{id}` | `_entity_view` (`bb_project.full`) | `bb_project.view` | `_entity_access` |
| Board | `view.project_board.project_board` | `/{ws}/project/{id}/board` | View (page display) | workspace membership | `_bb_workspace_match` (the display delegates: `access: type: none`) |
| Stats | `bb_core.bb_project.stats` | `/{ws}/project/{id}/stats` | Controller (`BbStatsController::projectStats`: the Insights period, tiles, New vs. done and People for this project, with Epic and Person filters) | `bb_project.view` | `_entity_access` |
| Tickets | `view.tickets.project_tickets` | `/{ws}/project/{id}/tickets` | View (page display) | workspace membership | `_bb_workspace_match` (the display delegates: `access: type: none`) |
| Runs | `view.runs.project_runs` | `/{ws}/project/{id}/runs` | View (page display) | `view bb_run` | view's own `access: type: perm` |
| Conductors | `view.conductors.project_list` | `/{ws}/project/{id}/conductors` | View (page display) | `view bb_conductor` | view's own `access: type: perm`. Rows are this project's conductors, any owner. |
| Templates | `view.bb_ticket_templates.project_list` | `/{ws}/project/{id}/templates` | View (page display) | `view bb_ticket_template` | view's own `access: type: perm`; rows are scoped by the template read scope. Its *Add template* header action opens the project-scoped add form. |
| Settings | `bb_core.bb_project.settings` | `/{ws}/project/{id}/settings` | Controller | `bb_project.update` (→ `edit bb_project`) | `_entity_access` |

## Team detail — five tabs, Overview default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Overview (default) | `entity.bb_team.canonical` | `/{ws}/team/{id}` | Controller | `bb_team.view` | `_entity_access` |
| Stats | `bb_core.bb_team.stats` | `/{ws}/team/{id}/stats` | Controller | `bb_team.view` | `_entity_access` |
| Tickets | `view.tickets.team_tickets` | `/{ws}/team/{id}/tickets` | View (page display) | workspace membership | `_bb_workspace_match` (the display delegates: `access: type: none`) |
| Runs | `view.runs.team_runs` | `/{ws}/team/{id}/runs` | View (page display) | `view bb_run` | view's own `access: type: perm` |
| Members | `bb_core.bb_team.members` | `/{ws}/team/{id}/members` | Controller (island) | `bb_team.view` | `_entity_access` |

## Group detail — two tabs, Overview default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Overview (default) | `entity.bb_group.canonical` | `/{ws}/group/{id}` | View mode (`_entity_view: bb_group.full`) | `bb_group.view` | `_entity_access` |
| Settings | `bb_core.bb_group.settings` | `/{ws}/group/{id}/settings` | Entity form | `bb_group.update` (→ `update any bb_group`, workspace lead) | `_entity_form` + `_entity_access` |

## Conductor detail — one tab, Overview default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Overview (default) | `entity.bb_conductor.canonical` | `/{ws}/conductor/{id}` | View mode (`_entity_view: bb_conductor.full`) | `bb_conductor.view` | `_entity_access` |

## Machine detail — one tab, View default

| Tab | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| View (default) | `entity.bb_machine.canonical` | `/user/{user}/machine/{id}` | View mode (`_entity_view: bb_machine.full`) | `bb_machine.view` | `_entity_access` |

## Admin routes (unchanged)

Every route under `/admin/bakers/*` — the collections for `bb_workspace`,
`bb_team`, `bb_project`, `bb_run`, `bb_conductor`, `bb_machine`, `bb_group`,
`bb_ticket`, plus `bb_core.settings` — is out of this umbrella's scope and
unchanged. They are listed here once, as a block, rather than one row each:
gated by `administer bakers` (or the specific admin-collection permission each
already carries), rendered by each entity's list builder, and reachable only
from the Drupal admin backend, never the rail.

## Entity types with no nav home of their own

## User area

| Place | Route name | Path | Renders | Gate | Mechanism |
|---|---|---|---|---|---|
| Account | `entity.user.canonical` | `/user/{user}` | `user.full` | `user.view` | Person-mark destination. View and Edit stay core's local tasks on this row. |
| Conductors | `view.conductors.user_list` | `/user/{user}/conductors` | View (page display) | `view bb_conductor` | view's own `access: type: perm` plus the `{user}` argument validator (`entity:user`, view). Sibling of Account in the user-area rail. Rows are this account's conductors, any workspace. |
| Machines | `view.machines.user_list` | `/user/{user}/machines` | View (page display) | `view bb_machine` | view's own `access: type: perm` plus the `{user}` argument validator (`entity:user`, view). Sibling of Account in the user-area rail. Rows are this account's machines. |
