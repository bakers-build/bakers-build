---
name: bb-init-project
description: Use when initializing, completing, repairing or upgrading bakers.build machine, connection or project configuration and the project's WORKFLOW.md, including partial or legacy setups.
---

# Initialize bakers.build configuration

Documentation owns choices and file ownership; the CLI planner owns supported changes. Generated
defaults and existing files alone do not establish readiness.
Upgrade, migrate or repair: follow [upgrade](references/upgrade.md).
Read [setup checks](references/setup-checks.md) before checking/applying.
For project/all, first [assess worktree compatibility](references/project-setup.md#check-worktree-compatibility-first)
before configuration checks or setup changes.

## Welcome

Called directly, first name the steps ahead and the files it writes: `.bakers/project.config.js` and `WORKFLOW.md`.

## Select and check the scope

Reuse caller choices. Repository setup uses `project` when prerequisites are ready; `all`
requires shared-setup authorization. Obtain missing scope authorization before shared writes.

| Scope | Ownership |
|---|---|
| `machine` | `~/.bakers/machine.config.js`: generated UUID `machine_id`, display `label`; local validation, no authentication. |
| `connection` | `~/.bakers/connections/default.js`: URL, OAuth credentials/plugins, optional `workspace_id` consumed only by `bakers ui`. Authenticate identity; no workspace-access check or machine prerequisite. |
| `project` | `.bakers/project.config.js`, optional `.bakers/connection.config.js`; independently requires machine/effective-connection readiness, leaves shared files unchanged. |
| `all` | Selected shared/project layers; project requires its name. |

1. Read `bakers config init --help` and `bakers config check --help`; run
   `bakers config check --scope <scope> --format json`.
   Preserve selected paths throughout: `--path <directory>` selects project root;
   `--machine-path <file>` / `--config <file>` select shared targets.
2. For project setup, independently check machine validity and effective connection authentication.
   With no machine identity, no authenticated user or an open machine decision (agent harness,
   routes, machine permissions, preview-tunnel policy), invoke `@bakers-build/bb-init` for it and resume afterwards. Resolve other prerequisites in their owning authorized scope.
3. Obtain only missing inputs; reuse explicit values. Machine: `--label`
   (`bakers init` generates `machine_id`). Connection: `--base-url`, `--client-id`,
   optional `--workspace-id`, `--secret-env <variable-name>`. Invent no identities, credentials or workspaces. Secrets stay
   out of prompts, arguments and reports; CLI owns private storage. Supply workspace only if
   caller-named; otherwise `bakers ui` uses its picker.
4. For project/all, follow [project setup](references/project-setup.md) before applying:
   resolve/create the real project, follow its decision matrix, preserve workflow policy and verify ignores.

## Apply and verify

Run `bakers config init --scope <scope>` with selected inputs/paths; project/all includes
`--project <resolved-name>` and `--path`; herdr-app adds
`--executor @bakers-build/addon-herdr-core` (Git workspace comes with it). CLI fills/migrates partial layers while
preserving custom values. Select a named connection using the current help and
[connection guide](https://bakers.build/configuration/connection.md). Reconcile generated files with
the documented choices from project setup, including settings without CLI flags.

If authentication fails after preparation, report written paths and incomplete setup; run the
connection's exact login remedy, then rerun initialization.
Run `bakers config check --scope <scope> --online` with the same paths (not for machine); it
needs authentication, not a workspace. Offline checks prove local validity.

For project/all, read the configured project and confirm its `WORKFLOW.md` starts with the entry
line and names only installed skills.
[Show written configurations back](../bb-init/references/setup-conversation.md#show-what-was-written).
Report paths, scope, resolved executor and worktree (herdr-app: `@bakers-build/addon-workspace-git`),
local validation, online readiness and remaining actions separately.

For project/all, end by [starting the session](references/project-setup.md#start-the-session).
