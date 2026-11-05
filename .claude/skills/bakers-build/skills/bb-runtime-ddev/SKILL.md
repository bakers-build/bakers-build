---
name: bb-runtime-ddev
description: Runtime guide for DDEV projects — bringing the environment up, logging in as test personas, and running commands, lint and tests inside it.
---

# Working in DDEV

This is the DDEV adapter for the frame's [provision](../bb-workflow/references/provision.md). The
caller supplies the selected worktree, the setup commands/provider the project's
`## bb-phase-provision` hint names, and the ticket's `test_as` personas. Return an unresolved
prerequisite when setup is missing.

## bb-phase-provision

**With the conductor's tools** `ddev_status`, `ddev_start` and `ddev_exec`
([tools](../bb-workflow/references/tools-conductor.md)), follow [provision](../bb-workflow/references/provision.md)'s tool path:
`ddev_status` for readiness, `ddev_start` for a stopped stack, `provision_up(<profile>)` for a
missing or wrong site. Run no host `ddev`.

**Without them** (a measured run, or a run without a conductor tool server), use the CLI: first
inspect `ddev describe` from the worktree root and check the selected site's readiness. A live stack
serving the required site/fixtures is a successful no-op; never blindly re-init one. If setup is
needed, run only the supplied commands, such as `ddev start`. Provider selection and defaults belong
to the project's setup instructions. Use a safe, self-contained subagent scoped to the worktree and
selected commands, without tracker credentials, and await completion.

A `ddev` call the sandbox blocks, or a needed reinstall with neither `provision_up` nor host
`ddev`, is an unresolved prerequisite naming `sandbox.trusted_commands`; report it, retry nothing.
Either way, verify the base URL actually responds and the required site/provider is ready before
returning.

**Do not bootstrap the worktree here.** Its creation, environment overlay, and CLI
(`node scripts/setup-worktree.mjs` and `.ddev/worktree-post.sh`) belong to the conductor's `after_create` hook. This adapter only brings
the DB/site up and never runs worktree bootstrap or invents a replacement setup hook.

Return the live base URL and readiness, or explicit failures and their reasons.

## bb-phase-work

Run container commands through `ddev_exec` when the run has it: a hint's `ddev <cmd>` becomes
`ddev_exec("<cmd>")`, and a project web command such as `ddev phpcs`, which is not on the container
`PATH`, runs by path: `ddev_exec(".ddev/commands/web/phpcs")`. Without it, run `ddev exec …` or the
configured DDEV commands. Read the project's work instructions for domain conventions and tooling.

## bb-phase-validate

Before running or writing tests, read the testing guidance named by the project's `WORKFLOW.md`.
Use its selected commands, data providers and test-selection rules, run as in `bb-phase-work`. Missing setup is an unresolved
prerequisite, not permission to invent a test environment.

## bb-phase-outtake

Before the outtake renders, every manual-review step names its persona from `test_as`. Use the
project's `bb-phase-outtake` login method to check each account and issue fresh access against a
reachable worktree URL. Return each issued link unchanged with persona, role and environment;
`anonymous` gets the plain URL and denied personas still get their access. A missing account or
login method is **missing**: create no account and substitute no administrator or other persona.

## Boundaries

Before sharing URLs, apply [preview links](../bb-workflow/references/preview-links.md). Publish no ticket
comments, choose no workflow state, and leave handoff rendering to the
[outtake](../bb-workflow/references/outtake.md) under the
[shared records contract](../bb-workflow/references/results.md).
