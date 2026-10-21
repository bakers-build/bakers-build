## Review flow

Every `review` step runs this same flow. A step owner's `review` section **references it and adds
only its work-type tail** (mandatory vs optional review, whether it provisions) rather than
restating the steps:

1. Read the ticket and confirmed scope (`@gaia/read-ticket`); frame the verdict
   (`@gaia/run-intake`), reusing the coding environment and evidence.
2. Load the selected review method and matching `Skills`/`Checks` under `WORKFLOW.md` › *Required skills*.
   Apply `@gaia/review-ticket` › *Reuse evidence*. Provision through
   `@gaia/resolve-environment` only when a chosen check needs runtime/access resolution.
3. Invoke `@gaia/review-ticket` in a review subagent with the method resolved from the `method:*`
   label; run `@gaia/verify-tests` only for the chosen checks. Use its returned verdict and findings.
4. Repair the closed list in this parent (*Review's closed repair list*), re-run the affected
   checks, and publish the new evidence.
5. Earlier owners return their typed verdict and records. Only the last matching owner performs
   steps 5–8 after collecting every sub-work. Aggregate [result records](results.md) across
   sub-works and render once (`@gaia/run-outtake`), reusing the persisted MR link and
   distinguishing reused, agent and human observations. Retain the full verdict, evidence and
   walkthrough in the typed review handoff. Print it in full in the terminal
   (`@gaia/run-outtake` › *Input contract*).
6. Take the human's confirmation of the verdict.
7. The credentialed parent publishes the typed verdict through `@gaia/publish-comment` and one
   `summary`, with any supplied measurement, before origin publication and transition. Follow
   `@gaia/workflow-step` completion order, including a blocked or state-restricted run.
8. On `OK`: the last matching work type (`@gaia/workflow-step` › *Multi-work single transition*)
   obtains or reuses explicit merge authorization, runs the merge gate `@gaia/merge-mr` with the
   ticket's `identifier` once, including its *Caller handoff*, and transitions to `done`
   **only after a verified merge** — a failed gate leaves the ticket in review with the concrete next action.

   On `Not OK`, use the causes from `@gaia/review-ticket` › *The verdict*. With **no `criterion`**,
   transition once to `coding`, no merge, for a finding **outside** the closed repair list, named.
   If any failing criterion carries the cause `criterion`, hold in `review`: present the causes
   and proposed rewrite, and take the operator's decision before proceeding. This also holds a
   mixed verdict; do not route it to qualification automatically. An **unattended** run stops with
   its handoff and summary published, as at the *Coding gate*.

   On an authorized transition, publish origin status/feedback before the final state write and
   STOP. On a hold, report it without changing the state.

   **The verdict comment carries its result on one line.** Publish it in type `review`, with
   `Status: **OK**` or `Status: **Not OK**` on a line of its own. *Coding gate* ›
   *Re-entry exception* reads that line to tell a re-entry from a first pass, so its wording is a
   contract rather than a house style.
