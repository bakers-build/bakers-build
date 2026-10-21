---
name: summarize-verification
description: Own the summary step — publish an overview of a completed environment verification's per-ticket results, filed regressions, and target environment, then transition to done.
when:
  workflow: [gaia_verification]
  step: [summary]
---

# Summarize a verification

Read the verifying run's record from the verification ticket rather than recomputing it: each tested
ticket's per-ticket result comment (its confirmed-check verdicts), the ticket's
`referenced_tickets` (the filed regression bugs), and the target environment (`environments` → name
and base URL). The tested set is the subject (`parent_id`) unioned with its `referenced_tickets`.

Publish a parent-authored `summary` comment presenting a per-ticket pass/fail matrix, the filed
regressions as links (or `none` when the pass was clean), and the target environment. Do not expose
credentials or let a subagent publish comments.

The observable result is the published verification overview.

## Run flow (step: summary)

You own the `summary` step. Do only this flow, then STOP.

1. Invoke `@gaia/read-ticket`, including all comments.
2. Publish the verification overview as described above.
3. Ask the human to confirm closing the verification.
4. After confirmation, invoke `@gaia/transition-ticket` with destination `done`.
5. Stop. Do not start or prepare any later work.
