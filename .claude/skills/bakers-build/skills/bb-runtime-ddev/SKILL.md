---
name: bb-runtime-ddev
description: Runtime guide for DDEV projects — bringing the environment up, logging in as test personas, and running commands, lint and tests inside it.
---

# Working in DDEV

This is the DDEV adapter for `@bakers-build/bb-resolve-environment`. The caller supplies the selected
worktree, the setup commands/provider the project's `## provision` hint names, and the ticket's `test_as` personas.
Return an unresolved prerequisite when setup is missing.

## provision

First inspect `ddev describe` from the worktree root and check the selected site's readiness.
A live stack serving the required site/fixtures is a successful no-op; never blindly re-init
one. If setup is needed, run only the supplied commands, such as `ddev start` or the project's
`ddev init --provider <p>`; plain `ddev init` means `existing-config`. Use a safe, self-contained
subagent scoped to the worktree and selected commands, without tracker credentials. Await
completion, then verify the base URL actually responds and the required site/provider is ready
before returning.

**Do not bootstrap the worktree here.** Its creation, environment overlay, and CLI
(`ddev init-worktree`) belong to the conductor's `after_create` hook. This adapter only brings
the DB/site up and never runs `init-worktree` or invents a replacement setup hook.

Return the live base URL and readiness, or explicit failures and their reasons.

## work

Everything runs in the container: `ddev exec …`. Lint commands come from the keytec-ddev-addon
(`ddev phpcs`, `ddev phpmd`, `ddev phpstan`).

## validate

Before running or writing ANY test in DDEV, read [testing](references/testing.md) — it prevents
the silent sqlite/MariaDB and empty-discovery traps.

## transition

Every manual-review step names its persona from `test_as`. Read [login links](references/logins.md),
issue one link per persona in the worktree, and hand each to `@bakers-build/bb-run-outtake` ›
*Manual review* with the persona, its role and the environment.

## Boundaries

Before sharing URLs, apply [preview links](../bb-workflow/references/preview-links.md). Publish no ticket
comments, choose no workflow state, and leave handoff rendering to `@bakers-build/bb-run-outtake` under
the [shared records contract](../bb-workflow/references/results.md).
