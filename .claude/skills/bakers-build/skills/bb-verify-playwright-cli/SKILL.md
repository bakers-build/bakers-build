---
name: bb-verify-playwright-cli
description: Inspect a confirmed browser path as the named persona using playwright-cli, recording observations and screenshots as agent evidence.
---

# Inspect a browser path

Use only for confirmed browser inspection with execution mode `agent`. Automated browser
suites, including Playwright, run through `@bakers-build/bb-verify-tests`. Read the [shared records and
evidence contract](../bb-workflow/references/results.md) and the supplied persona-specific
paths from `@bakers-build/bb-scenario`; this helper executes them rather than selecting coverage.

Before inspection use `@bakers-build/bb-resolve-environment` to confirm the target surface and every
required persona's access. Preserve anonymous, intentionally denied and missing personas.
Unresolved access blocks the dependent path; an administrator session is not a substitute.
Load the selected persona's saved auth state before the first authenticated action and confirm
the actual identity. Use an anonymous session for an anonymous path.

Run the ordered `playwright-cli` actions against the resolved absolute URL. Record actual
persona, environment, starting URL, actions or component-contract selectors, and expected versus
observed behavior. Capture the required before/after screenshots. A denial can pass when it
is the confirmed expected observation.

Return one `results` record per check, linked through its check ID to all covered ACs.
Preserve purpose, mode and coverage independently; a successful one-off walk is not permanent
regression coverage. Use the shared statuses and durable evidence, including the immutable
revision. An intentional diagnosis RED is recorded as failed with the observed defect;
coding/review cannot treat it as GREEN. Missing observations are blocked or not_run, never
passed. Agent inspection leaves `manual_review` pending until a human records their observation.

## Browser artifacts

Follow the transient root in [evidence and links](../bb-workflow/references/evidence.md). Under its `playwright/` tool directory,
place captured output in `logs/`, screenshots in `images/`, and any one-off driver at the tool
root. Captured logs start with the command; use subject names and applicable state suffixes.
Direct screenshot paths into `images/`; keep any traces/videos under the tool root rather
than filing them as logs. Existing permanent suites keep their configured reports through
`@bakers-build/bb-verify-tests`.

At review apply the shared reuse contract: read coding's captured output/screenshots in the
shared worktree, retain original revision/scope, and explain any necessary rerun. Fresh review
artifacts use the `-review` suffix. If another machine lacks required artifacts, report the
gap and request or perform a fresh authorized inspection; absent evidence cannot pass.

Return records to the owner. Publish no comment and choose no transition; `@bakers-build/bb-run-outtake`
renders observed results separately from the human walkthrough.
