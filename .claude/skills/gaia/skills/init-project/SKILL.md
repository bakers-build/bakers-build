---
name: init-project
description: Use when initializing or completing GAIA machine, connection, or project configuration, including partial setup.
---

# Initialize GAIA configuration

Use the CLI inventory/repair planner; existing files alone do not establish readiness.
For requested migration use `@gaia/upgrade-project`.
Read [setup checks](references/setup-checks.md) before checking/applying.

## Select and check the scope

Reuse caller choices. Repository setup uses `project` when prerequisites are ready; `all`
requires shared-setup authorization. Obtain missing scope authorization before shared writes.

| Scope | Ownership |
|---|---|
| `machine` | `~/.gaia/machine.config.js`: `machine_id`, local operator `user_id`, positive `max_parallel`; local validation, no authentication. |
| `connection` | `~/.gaia/gaia.config.js`: URL, OAuth credentials/plugins, optional `workspace_id` consumed only by `gaia ui`. Authenticate identity; no workspace-access check or machine prerequisite. |
| `project` | `.gaia/conductor.config.js`, local overrides, optional `.gaia/gaia.config.js`; independently requires machine/effective-connection readiness, leaves shared files unchanged. |
| `all` | Selected shared/project layers; project requires its name. |

1. Read `gaia config init --help` and `gaia config check --help`; run
   `gaia config check --scope <scope> --format json`.
   Preserve selected paths throughout: `--path <directory>` selects project root;
   `--machine-path <file>` / `--config <file>` select shared targets.
2. For project setup, independently check machine validity and effective connection authentication.
   With no machine identity or no authenticated user, invoke `@gaia/init` for the missing layer
   and resume afterwards. Resolve other prerequisites in their owning authorized scope.
3. Obtain only missing inputs; reuse explicit values. Machine: `--machine-id`, `--user-id`,
   `--max-parallel`. Connection: `--base-url`, `--client-id`, optional `--workspace-id`,
   `--secret-env <variable-name>`. Invent no identities, credentials or workspaces. Secrets stay
   out of prompts, arguments and reports; CLI owns private storage. Supply workspace only if
   caller-named; otherwise `gaia ui` uses its picker.
4. For project/all, follow [project setup](references/project-setup.md) before applying:
   resolve/create the real project, collect operator hooks, choose one or more `Skill set`
   entries, preserve workflow policy and verify ignores.

## Apply and verify

Run `gaia config init --scope <scope>` with selected inputs/paths; project/all includes
`--project <resolved-name>` and `--path`. CLI fills/migrates supported partial layers while
preserving custom values. Keep `--project-connection keep`; use `create` only for an explicitly
requested override.

If authentication fails after preparation, report written paths and incomplete setup; follow the
selected connection's exact `gaia` provider login remedy and rerun initialization.
Run `gaia config check --scope <scope> --online` with the same paths. Machine online checks are
inapplicable; other scopes require authentication, not a workspace. Offline checks prove local validity.

For project/all, read the configured project and run `gaia validate` at its root; use
`--skills <dir>` when skills are not vendored. Report `FAILED` as workflow failure.
Report written paths, scope, local validation, online readiness and remaining actions separately.
Stop after setup; do not start ticket work.
