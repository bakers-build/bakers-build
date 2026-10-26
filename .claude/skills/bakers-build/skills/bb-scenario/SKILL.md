---
name: bb-scenario
description: Prepare observable browser paths per required persona when the confirmed verification plan selects a browser surface.
---

# Prepare browser paths

Use only for a browser surface selected by the confirmed scope and verification plan. Read
the [shared records contract](../bb-workflow/references/results.md); the `test_as` personas
come from qualification and environment/access resolution from `@bakers-build/bb-resolve-environment`.

Prepare one shortest complete observable path per required persona, including anonymous and
intentionally denied personas. Keep missing personas and their paths, naming the access
limitation. Each path supplies its check ID, AC IDs, persona, environment, starting URL,
prerequisites, ordered actions, and expected visible observations. For a bug include the
current failing observation. Several actions may form one path; separate checks when expected
outcomes or personas differ.

Use visible interface labels and the [audience and register](../bb-workflow/references/boundaries.md) rules. For an
agent browser inspection include required auth-state loading, stable selectors where useful,
and before/after screenshot points. Human instructions must be executable by the intended
reviewer using the supplied access.

Keep purpose, execution mode, and permanent versus one-off coverage distinct in `checks`.
Browser suites are automated checks run by `@bakers-build/bb-verify-tests`; agent browser inspection
runs through `@bakers-build/bb-verify-playwright-cli`. Preparing or running an agent path does not complete
human review: `manual_review` remains pending until an actual human observation is recorded.

Return paths and unresolved prerequisites to the owner. This helper plans only: it executes
no check, provisions no environment, creates no account, and publishes no destination.
`@bakers-build/bb-run-outtake` renders the supplied paths separately from observed check results.
