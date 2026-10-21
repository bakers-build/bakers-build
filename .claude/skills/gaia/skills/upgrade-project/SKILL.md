---
name: upgrade-project
description: Use when migrating or repairing existing GAIA configuration and project workflow policy, including missing or partial layers.
---

# Upgrade GAIA configuration and project policy

CLI owns inventory, migrations and missing-layer repair. Blank installations use
`@gaia/init-project`; partial installations stay here. Before checking/applying, read
[setup checks](../init-project/references/setup-checks.md).

## Check, apply, recheck

1. Record CLI version, discovered GAIA plugin version/path, `git status`, `git diff`.
   Read `gaia config upgrade --help` and `gaia config check --help`.
   Preserve caller-selected executable/version/paths. Run `gaia update` only when requested or
   authorized as prerequisite; report package versions separately from configuration migration.
2. Select `machine` (host identity/capacity), `connection` (global URL/OAuth/plugins/optional workspace),
   `project` (conductor, local overrides, optional connection) or `all`. Omitted scope covers all
   applicable layers; project is inapplicable outside a checkout. Bound repairs with explicit scope.
3. Run `gaia config check --scope <scope> --format json`; retain `--path <directory>` for project
   root and `--machine-path <file>` / `--config <file>` for shared targets. Project checks both
   prerequisites without changing shared files.
4. Snapshot affected workflow/policy files outside the repository; protect secrets. CLI backs up
   configuration during validated apply. Preserve unrelated changes. Obtain missing inputs via
   help options, `--secret-env <name>` for secrets, explicit identities/workspaces. Missing project
   identity needs supplied `--project <name>`. Files/schema markers alone prove no readiness.
5. Run `gaia config upgrade --scope <scope>` with selected inputs/paths. Preserve supported values
   and existing project connections; keep `--project-connection keep` unless creation of an absent
   override was explicitly requested. Global inheritance stays optional.
6. Apply shared setup checks; report files remaining changed after failure. Offline upgrade proves
   schema migration only. Run `gaia config check --scope <scope> --online` with identical paths;
   follow the selected connection's exact `gaia` login remedy and recheck. Machine online checks
   are inapplicable; other scopes require authentication, workspace optional. Failed authentication
   leaves prepared setup incomplete.

## Preserve project policy

For selected projects, follow [WORKFLOW.template.md](../init-project/references/WORKFLOW.template.md);
create absent workflows. Retain `## Loaded skills` lifecycle owners including `@gaia/essential-skills`,
one or more `Skill set` references (first default), local choices, extra skills, exact commands,
applicability, setup and inputs. Read complete selected sets, tables and required-skill rule.
Fold separate check documents and superseded overrides into these sections before removing references.
Resolve ambiguity with the user, reusing authorization.

Ensure `/assets-ai/` ignored; remove retired `/issues/` ignore. Verify `git check-ignore -v assets-ai/probe`
and every generated secret-bearing override, including `.gaia/conductor.config.local.js`.

For legacy archives (`docs/evidence/`, `docs/decisions/*-evidence/`, committed `issues/`), find/report
readers before proposing deletion. Surviving readers need decisions. Authorized deletion rescues
decision records into the project's decision-record directory and repoints readers. Ambiguous/destructive
replacements require explicit approval; retain snapshots through verification.

Verify plugin metadata/skill references through supported discovery; report unavailable names.
Upgrade installs no skills. Read configured project; run `gaia validate` at its root
(`--skills <dir>` if unvendored); surface `FAILED`.
Report configuration/workflow changes, deleted/rescued paths, validation, online readiness and follow-up
separately. Stop; rotate no secrets or start ticket work.
