---
name: verify-tests
description: Execute confirmed automated suites, including Playwright, and selected non-browser checks with observed results per check.
---

# Verify tests and checks

Read the confirmed test plan and the [shared records and evidence
contract](../method-context/references/results.md). This helper runs automated suites,
including browser suites such as Playwright, plus selected non-browser agent checks.
`@bakers-build/verify-playwright-cli` owns agent browser inspection; human checks await the human.

Before execution use `@bakers-build/resolve-environment` to establish each check's prerequisites,
cwd/connection and actor access. CLI-only or no-runtime checks remain valid. Preserve every
required actor, including anonymous, denied, and unresolved identities. A missing prerequisite
blocks its dependent check; never substitute admin or another environment to obtain a pass.

Run the confirmed `command_or_steps` with the selected environment and actual actor. Retain
the check's ID, AC mapping, purpose (`project` or `functional`), execution mode, and coverage
(`permanent` or `one_off`). A one-off automated probe is still one-off coverage. Follow the
project's configured commands and fixtures; invent no replacement tests or setup hooks.
Deduplicate identical executions while retaining every applicable check/AC relationship.

Return one `results` record per check using the shared status vocabulary. Compare actual output
with the expected observation, record the actual actor, environment and immutable revision,
and explain failures or blockers. Intentional RED during diagnosis is a failed result with
the expected defect explained; it never counts as GREEN during coding or review.

No observed output means no passed result: distinguish `blocked` or `not_run` from an executed
failure. A command description, source diff, or successful process exit without the required
observation does not establish acceptance. Project checks can have no AC mapping; functional
checks must identify the criteria they observe. Preserve multiple results covering one AC
instead of collapsing them into a single claimed pass.

Capture output under `@bakers-build/essential-skills`' durable evidence and transient-root rules.
Permanent suites retain configured report paths; record durable observations even when their
artifacts expire. At review reuse valid evidence under the shared contract, preserving its
original revision and scope; rerun only for a recorded concrete reason.

Return records to the owner without publishing or transitioning. Automated and agent results
leave `manual_review` pending until an actual human observation exists.
