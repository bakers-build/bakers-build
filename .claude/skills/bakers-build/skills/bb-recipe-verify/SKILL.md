---
name: bb-recipe-verify
description: Recipe for tickets of type verification — re-verify a subject ticket and its linked tickets on one environment as their test personas, with one regression bug per failure.
---

# Verify on an environment

The ticket's `parent_id` is the subject, its one `environments` entry the target (`base_url`), and
its `referenced_tickets` collects the regressions it files.

## bb-gates

| Type | Gates |
|---|---|
| verification | default |

## bb-state-plan

### bb-phase-work

Resolve subject and target. The tested set is the subject plus its `referenced_tickets` whose
`environments` include the target; every other one is recorded as skipped. Load each tested
ticket's confirmed test plan and its `test_as` personas.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, tested set, skipped tickets and, per ticket, its
checks and personas. Its approval approves the set.

## bb-state-working

### bb-phase-work

A verification builds nothing: skip the remote base check. Run each tested ticket's confirmed checks
against the target as its personas: its Playwright-BDD suite and browser inspection through the
frame's tool discovery and fallback, the suite once with
`PLAYWRIGHT_BASE_URL=<base_url>`, filtered to its own scenarios, and its manual paths with
browser inspection. A missing persona is reported as missing and blocks its checks; nobody else runs
them, an administrator least of all. A missing required check or evidence is a failure; an
unavailable optional path is skipped.

### bb-phase-deliver

No commit and no merge request. Publish one `result` comment per tested ticket with each check's
pass or fail, persona and evidence. Per failed check, search prior art, then create one ticket of
type `bug` naming the target and the failed check, and union it into this ticket's
`referenced_tickets` (read-modify-write).

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict as a pass/fail matrix per tested ticket and check, the regressions as links (`none` on a
clean pass), and the target. `OK` means every check ran or is reported blocked and every failure has
its regression ticket; failing tickets do not make it `Not OK`.

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
