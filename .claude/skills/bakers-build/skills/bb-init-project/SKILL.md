---
name: bb-init-project
description: Use when initializing or completing bakers.build machine, connection, or project configuration, including partial setup.
---

# Initialize bakers.build configuration

Use the CLI inventory/repair planner; existing files alone do not establish readiness.
For requested migration use `@bakers-build/bb-upgrade-project`.
Read [setup checks](references/setup-checks.md) before checking/applying.

## Select and check the scope

Reuse caller choices. Repository setup uses `project` when prerequisites are ready; `all`
requires shared-setup authorization. Obtain missing scope authorization before shared writes.

| Scope | Ownership |
|---|---|
| `machine` | `~/.bakers/machine.config.js`: generated UUID `machine_id`, display `label`, positive `max_parallel`; local validation, no authentication. |
| `connection` | `~/.bakers/bakers.config.js`: URL, OAuth credentials/plugins, optional `workspace_id` consumed only by `bakers ui`. Authenticate identity; no workspace-access check or machine prerequisite. |
| `project` | `.bakers/conductor.config.js`, local overrides, optional `.bakers/bakers.config.js`; independently requires machine/effective-connection readiness, leaves shared files unchanged. |
| `all` | Selected shared/project layers; project requires its name. |

1. Read `bakers config init --help` and `bakers config check --help`; run
   `bakers config check --scope <scope> --format json`.
   Preserve selected paths throughout: `--path <directory>` selects project root;
   `--machine-path <file>` / `--config <file>` select shared targets.
2. For project setup, independently check machine validity and effective connection authentication.
   With no machine identity or no authenticated user, invoke `@bakers-build/bb-init` for the missing layer
   and resume afterwards. Resolve other prerequisites in their owning authorized scope.
3. Obtain only missing inputs; reuse explicit values. Machine: `--label`, `--max-parallel`
   (`bakers init` generates `machine_id`). Connection: `--base-url`, `--client-id`,
   optional `--workspace-id`, `--secret-env <variable-name>`. Invent no identities, credentials or workspaces. Secrets stay
   out of prompts, arguments and reports; CLI owns private storage. Supply workspace only if
   caller-named; otherwise `bakers ui` uses its picker.
4. For project/all, follow [project setup](references/project-setup.md) before applying:
   resolve/create the real project, collect operator hooks, write the phase hints, preserve workflow policy and verify ignores.

## Apply and verify

Run `bakers config init --scope <scope>` with selected inputs/paths; project/all includes
`--project <resolved-name>` and `--path`. CLI fills/migrates supported partial layers while
preserving custom values. Keep `--project-connection keep`; use `create` only for an explicitly
requested override.

If authentication fails after preparation, report written paths and incomplete setup; follow the
selected connection's exact `bakers` provider login remedy and rerun initialization.
Run `bakers config check --scope <scope> --online` with the same paths. Machine online checks are
inapplicable; other scopes require authentication, not a workspace. Offline checks prove local validity.

For project/all, read the configured project and confirm its `WORKFLOW.md` starts with the entry
line and names only installed skills.
Report written paths, scope, local validation, online readiness and remaining actions separately.
Stop after setup; do not start ticket work.
