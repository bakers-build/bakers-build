# Lookup, setup and time tools

Called like every tool in [tools](tools.md). IDs are UUIDs unless named. Lists take optional
`limit` (1–100) and `offset` and return `next_offset`, null on the last page; a count or "none"
needs every page. A conductor run is served only the lookups [conductor](tools-conductor.md) names.

| Operation | Tool | Arguments | Result |
|---|---|---|---|
| Read your user | `bakers_user_read` | none | `uuid`, `name`, `position`, `background`; empty where unset |
| List workspaces | `bakers_workspace_list` | none; works before a workspace is chosen | `workspaces` (`uuid`, `name`, `slug`) |
| List groups | `bakers_group_list` | `workspace`; optional `group` | `groups` (`uuid`, `name`, `description`) |
| Create a group | `bakers_group_create` | `workspace`, `name`; optional `description` | saved `uuid`, `name`, `description` |
| List teams | `bakers_team_list` | `workspace` | `teams` (`uuid`, `name`) |
| List projects | `bakers_project_list` | optional `workspace`, `group`, `query` | `projects` (`uuid`, `key`, `name`, `group`) |
| Read a project | `bakers_project_read` | `project` (key or UUID) | `uuid`, `key`, `name`, `description`, `group`, `teams`, `repository`, `coder_config` |
| Create a project | `bakers_project_create` | `group`, `name`, `teams`; optional `description`, `repository` (`url`, `default_branch`, `branch_convention`), `coder_config` | as read |
| List conductors | `bakers_conductor_list` | `project` (key or UUID) | `conductors` (`uuid`, `conductor_id`, `label`, `active`, `status`) |
| List labels | `bakers_label_list` | `workspace`; optional `query` | `labels` (`uuid`, `name`) |
| Run a template | `bakers_ticket_template_run` | `template`; optional `title`, `description`, `workflow`, `project`, `conductor`, `labels`, `target_state` | `uuid`, `identifier` |
| Cancel runs | `bakers_run_cancel` | `ticket`/`machine_id`, `reason` | `runs`; by machine maybe none |
| Restart a parked ticket | `bakers_ticket_restart` | `ticket` | `ticket`, `restarted_at`, `restarted_by`; conflict when not parked |
| List runs | `bakers_ticket_runs_list` | `ticket` | `runs` (`uuid`, `state`, `state_at_start`, `agent`, `conductor`, `started_at`, `closed`); newest first |
| List activity | `bakers_ticket_activity_list` | `ticket` or `project`, not both | `events` (`uuid`, `kind`, `created`, `actor`, `ticket`, `message`); newest first |
| Propose time | `bakers_time_propose` | `entries`; optional `project`, `account` | `submission`, `worklogs` in entry order; a failing entry stores nothing |
| List own worklogs | `bakers_worklog_list` | `from`, `to` (`Y-m-d`); optional `limit` (1–50), `offset` | `data` (worklogs), `next_offset` |
