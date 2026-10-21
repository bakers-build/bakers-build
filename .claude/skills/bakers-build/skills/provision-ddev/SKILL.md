---
name: provision-ddev
description: Bring a selected DDEV environment to readiness using configured commands, and resolve supplied actors to uid-bound access.
---

# Provision the selected DDEV environment

This is the DDEV adapter for `@bakers-build/resolve-environment`. The caller supplies the selected
worktree, configured setup commands/provider, and required actors; project `WORKFLOW.md`
owns provisioning timing. Return an unresolved prerequisite when setup is missing.

First inspect `ddev describe` from the worktree root and check the selected site's readiness.
A live stack serving the required site/fixtures is a successful no-op; never blindly re-init
one. If setup is needed, run only the supplied commands, such as `ddev start` or the project's
`ddev init --provider <p>`. Use a safe, self-contained subagent scoped to the worktree and
selected commands, without tracker credentials. Await completion, then verify the base URL
actually responds and the required site/provider is ready before returning.

**Do not bootstrap the worktree here.** Its creation, environment overlay, and CLI
(`ddev init-worktree`) belong to the conductor's `after_create` hook. This adapter only brings
the DB/site up and never runs `init-worktree` or invents a replacement setup hook.

When actors are supplied, read [actor resolution and reuse](references/actors.md) and resolve
every one, including anonymous and denied actors. Return live base URLs and readiness together
with the complete actor/access set, or explicit failures and their reasons.

Before sharing URLs, apply `@bakers-build/essential-skills`' local preview rules. Publish no ticket
comments, choose no workflow state, and leave handoff rendering to `@bakers-build/run-outtake` under
the [shared records contract](../method-context/references/results.md).
