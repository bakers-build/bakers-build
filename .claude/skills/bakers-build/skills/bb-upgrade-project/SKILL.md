---
name: bb-upgrade-project
description: Use when migrating or repairing existing bakers.build configuration and project workflow policy, including missing or partial layers.
---

# Upgrade bakers.build configuration and project policy

CLI owns inventory, migrations and missing-layer repair. Blank installations use
`@bakers-build/bb-init-project`; partial installations stay here. Before checking/applying, read
[setup checks](../bb-init-project/references/setup-checks.md).

## Check, apply, recheck

1. Record CLI version, discovered bakers.build plugin version/path, `git status`, `git diff`.
   Read `bakers config upgrade --help` and `bakers config check --help`.
   Preserve caller-selected executable/version/paths. Run `bakers update` only when requested or
   authorized as prerequisite; report package versions separately from configuration migration.
2. Select `machine` (host identity/capacity), `connection` (global URL/OAuth/plugins/optional workspace),
   `project` (conductor, local overrides, optional connection) or `all`. Omitted scope covers all
   applicable layers; project is inapplicable outside a checkout. Bound repairs with explicit scope.
3. Run `bakers config check --scope <scope> --format json`; retain `--path <directory>` for project
   root and `--machine-path <file>` / `--config <file>` for shared targets. Project checks both
   prerequisites without changing shared files.
4. Snapshot affected workflow/policy files outside the repository; protect secrets. Preserve
   unrelated changes. Obtain missing inputs via
   help options, `--secret-env <name>` for secrets, explicit identities/workspaces. Missing project
   identity needs supplied `--project <name>`. Files/schema markers alone prove no readiness.
5. Run `bakers config upgrade --scope <scope>` with selected inputs/paths. Preserve supported values
   and existing project connections; keep `--project-connection keep` unless creation of an absent
   override was explicitly requested. Global inheritance stays optional.
6. Apply shared setup checks; report files remaining changed after failure. Offline upgrade proves
   schema migration only. Run `bakers config check --scope <scope> --online` with identical paths;
   follow the selected connection's exact `bakers` login remedy and recheck. Machine online checks
   are inapplicable; other scopes require authentication, workspace optional. Failed authentication
   leaves prepared setup incomplete.

## Preserve project policy

For selected projects, follow [WORKFLOW.template.md](../bb-init-project/references/WORKFLOW.template.md);
create absent workflows. Rename phase hints to `## bb-phase-<phase>`: `## provision`, `## work`,
`## validate` and `## deliver` keep their phase; `## transition` → `## bb-phase-outtake`, except an
origin-label override → `## bb-phase-transition`. Move an old loader's sections: the entry line
replaces `## Loaded skills` and `## Skill set`; `## Skills` → `## bb-phase-work`; `## Checks` →
`## bb-phase-validate`; `### Setup` → `## bb-phase-provision`; before-merge rules →
`## bb-phase-deliver`; input overrides → the phase where they are used; drop `## Required skills`;
`## Standards` and test lore → `CLAUDE.md` pointers and repository docs. Keep every command and its applicability; resolve ambiguity with the user.

Ensure `/assets-ai/` ignored; remove retired `/issues/` ignore. Verify `git check-ignore -v assets-ai/probe`
and every generated secret-bearing override, including `.bakers/conductor.config.local.js`.

For legacy archives (`docs/evidence/`, `docs/decisions/*-evidence/`, committed `issues/`), find/report
readers before proposing deletion. Authorized deletion rescues decision records into the project's
decision-record directory and repoints readers. Ambiguous/destructive replacements require explicit approval; retain snapshots through verification.

Verify skill references through supported discovery; report unavailable names. Upgrade installs
no skills. Ensure `WORKFLOW.md` starts with the entry line, without a `pingpong` clause, and names
only installed skills. Report configuration/workflow changes, deleted/rescued paths, validation,
online readiness and follow-up separately. Stop; rotate no secrets or start ticket work.
