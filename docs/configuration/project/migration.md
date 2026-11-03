---
title: Configuration migration
description: How bakers config upgrade completes current configuration - scopes, preview, apply, verification, and what each diagnostic code asks you to repair.
---

# Configuration migration

`bakers config upgrade` fills missing template slots in current configuration files, and `bakers config check` tells you whether the result is valid.

The everyday update steps are on [Update bakers.build](/configuration/machine/updates); this page is the detail behind them: scopes, how preview and apply behave, and how to read each finding as a repair instruction.

## Scopes

Every `bakers config` command takes `--scope`:

| Scope | Files | Current schema |
|---|---|---|
| `machine` | `machine.config.js` in the bakers.build home: host identity, capacity, agents | 1 |
| `connection` | The selected connection file: server and sign-in | 1 |
| `project` | The checkout's `.bakers/` files: conductor configs and the local selector | 1 (conductor configs) |
| `all` | All of them | - |

A write to another scope's file needs `--scope all`, because one scope may not write another. `--path <directory>` selects the project root; it does not replace the home directory. `--machine-path` and `--config` override the machine and connection files, and `--connection <id>` picks a named connection. Nothing under `~/.config/conductor` is read; a machine that only has a file there runs `bakers init` once. A leftover `~/.bakers/conductor.config.local.js` blocks every scope until its values move to the machine, connection or project local config and the file is deleted.

## Preview, apply, check

```sh
bakers config upgrade --scope all --connection team --dry-run
bakers config upgrade --scope all --connection team
bakers config check --scope all --connection team --online
bakers config upgrade --scope all --connection team --dry-run
```

Replace `team` with your connection name. Run these from the checkout, inspect the first report before applying, and expect the last preview to show no change: a second successful upgrade is a no-op.

- **Preview** (`--dry-run`) parses the source without executing it and makes no writes, backups, imports or network calls. The report lists file states, fingerprints, redacted diffs, the schema of each file and findings.
- **Apply** rechecks each file's fingerprint and stops with `changed_since_planning` if a file moved since the plan. It writes a private non-overwriting backup `<file>.bakers.bak` (mode 0600), then replaces the file atomically. If a write fails it restores the files already changed and names any it could not restore.
- **Check** validates offline by default. `--online` authenticates and verifies each selected workspace (not applicable to the machine scope), and resolves each machine and project `addons` entry to report one listed in a file its addon does not allow; offline, that step is skipped with an `addon_scope_skipped` info finding. An offline `ok` says the local shape is valid, and a report that says online was skipped is not a successful online check.

`--format json` prints the report as JSON and disables prompts, `--yes` disables prompts and automatic selections, and `--project`, `--workspace` and `--base-url` supply values the planner would otherwise ask for. Migration never invents an identity or workspace.

A generated file or current schema marker does not prove a working conductor. After migrating, confirm the agent catalog with `bakers agents` and start a worker only when it lists what you expect. Schema versions belong to the configuration format, not the npm release, so never fix a failure by editing only `schema_version`; the actual shape must match.

## Old configuration

Every file starts at schema version 1, and the upgrade has no migration steps. A file at another schema version, a project config with `conductor_id`, `machine_id` or `label`, a machine file with `user_id`, or a `machine_id` that is not a UUID fails loading with a message naming `bakers init`. Run `bakers init` to write current files; it generates the machine's UUID and asks for its label ([Machines](/configuration/machine)).

## Read a finding as a repair instruction

Each finding has a `code`, the file and key, what was expected and a recheck command. Find the code below.

| Code | Meaning | Repair |
|---|---|---|
| `scope_required`, `invalid_scope` | `init` needs an explicit scope; scope is one of machine, connection, project, all. | Pass `--scope`. |
| `project_required` | No project root resolved, or `init` for a project lacks a name. | Run inside the checkout or pass `--path` and `--project <name>`. |
| `missing_required_file` | A required file does not exist. | Run the `bakers config init` command the finding prints. |
| `unreadable_file` | The file is not a readable regular file. | Restore read access, then recheck. |
| `syntax_error` | The file does not parse. | Fix the syntax at the reported line; nothing in that file is migrated until then. |
| `unsupported_source_shape` | The file exports something the planner cannot read statically, for example a computed export or a spread in `bakers`. | Expose a plain `export default { ... }` object, or for a project file run `bakers config upgrade --scope project`. |
| `unknown_value` | A required value is computed, so its value cannot be known. | Write the value as a literal; the planner does not guess. |
| `missing_required_key`, `invalid_value` | A required key is absent or has the wrong type. Online, `invalid_value` means the connection or its plugins failed to load. | Set the named key; a missing `site.base_url` belongs in the connection file, not the machine file. Online, inspect the connection file and recheck. |
| `version_marker_disagreement` | The header marker and the `schema_version` field differ. | Reconcile both with the file's real shape. |
| `future_schema_version` | The file is newer than this CLI. | Install a newer bakers.build release; do not downgrade the marker. |
| `misplaced_key` | A key sits in a file that does not own it. | Move it into the file the finding names. |
| `conflicting_values` | Source and destination hold different values. | Decide which is intended, edit the other to match, and retry. |
| `out_of_scope_write_required` | The repair must write outside the selected scope. | Re-run with `--scope all`. |
| `dead_key` | A key in `conductor.config.local.js` is no longer read, such as `base_url` or `oauth`. | Remove it after confirming the connection holds the intended value. |
| `retired_key` | Machine `agents.addons` or top-level `ports`; loading fails until it moves. The remediation shows the exact `addons: [...]` fragment. | Paste the fragment. |
| `addon_scope_not_allowed` | An `addons` entry sits in a file its addon does not allow (`--online` only); it is not loaded there. | Move the entry to the file the finding names. |
| `addon_scope_skipped` | Info: an offline check did not resolve `addons` entries, so their scopes were not checked. | Run `bakers config check --online` to check them. |
| `superseded_file` | A legacy project connection override is still supported. | Create a named connection and select it in `.bakers/connection.config.local.js`. |
| `changed_since_planning` | A file changed between plan and apply. | Re-run the upgrade. |
| `write_failure` | A write failed and changes were restored, or some files remain changed. | Restore any named file from its `.bakers.bak` backup, fix permissions and retry. |
| `authentication_failure` | `--online` could not sign in with the selected identity. | Check the credentials in the connection file, sign in again with `bakers auth login`, then recheck. |
| `cancelled_selection` | Interactive setup input was cancelled. | Re-run `bakers config init` with an explicit `--scope` and the required input flags. |

An ambiguous project name (the same name in several workspaces) stops with an error that lists the candidates; commit the intended `bakers.workspace`. Keep the command, the failing key and the source path when you ask for help, and leave out secret values.
