---
name: bb-verify-on-environment
description: Own the verifying step — re-verify a subject ticket and its linked tickets on a target environment, file a regression bug per failure, and transition to summary.
inputs:
  verify.prompt:
    description: how to re-verify a ticket on the target environment
    default: run each tested ticket's authored Playwright-BDD `.feature` suite once with `PLAYWRIGHT_BASE_URL=<env base_url>` filtered to the ticket's own scenarios; walk its `test_steps` via `playwright-cli` (state-load auth first) when a driver is configured
---

# Verify on an environment

Resolve the verification ticket's target environment (`environments` → base URL) and subject
(`parent_id`). Build the tested set as the subject unioned with the subject's `referenced_tickets`
(its linked tickets, like a deployment's release batch), keeping only tickets assigned to the target
environment and recording each other ticket as skipped rather than testing it.

For every tested ticket, load its confirmed test plan and follow the effective `verify.prompt`.
Resolve named tests from that plan and repository, not only `.feature` URLs in ticket links.
Missing required checks or evidence are failures; report unavailable optional paths as skipped.
The configured prompt owns framework, commands and driver policy.

Publish a per-ticket result comment recording each check's pass or fail on that tested ticket. On
any failed check, invoke `@bakers-build/bb-create-ticket` with its prior-art/reconciliation gates for one linked ticket of type `bug` capturing the regression and naming the environment,
and read-modify-write union its UUID onto the verification ticket's `referenced_tickets`. Never
clobber existing `referenced_tickets`, never expose credentials, and never let a subagent publish
comments.

The observable result is the recorded per-ticket verification plus the filed regression bugs.

## Run flow (step: verifying)

You own the `verifying` step. Do only this flow, then STOP.

1. Invoke `@bakers-build/bb-read-ticket`, including all comments.
2. Re-verify the tested set on the target environment as described above, using the project's
   `verify.prompt` input under `@bakers-build/bb-workflow` › *Required skills*. Invoke
   `@bakers-build/bb-resolve-environment` with the verification ticket's target environment and each tested
   ticket's `test_as` personas before execution.
   Resolve remote access as well as local readiness. Report checks through
   [result records](../bb-workflow/references/results.md), preserving actual users and modes.
3. Publish the verification-ticket handoff and one summary identifying the tested set,
   per-ticket result references and regressions under `@bakers-build/bb-workflow` completion order.
4. Invoke `@bakers-build/bb-transition-ticket` with destination `summary`.
5. Stop. Do not start or prepare the summary state.
