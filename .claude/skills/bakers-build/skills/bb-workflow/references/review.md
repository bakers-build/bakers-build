## Review flow

Every `review` state runs this same flow. A recipe's `review` section names the review method and
whether review is mandatory per type, never the steps:

1. Read the ticket and confirmed scope (`@bakers-build/bb-read-ticket`); frame the verdict
   (`@bakers-build/bb-run-intake`), reusing the coding environment and evidence.
2. Load the recipe's review skills and matching hint rows under `@bakers-build/bb-workflow` › *Required skills*.
   Apply `@bakers-build/bb-review-ticket` › *Reuse evidence*. Provision through
   `@bakers-build/bb-resolve-environment` only when a chosen check needs runtime/access resolution.
3. Invoke `@bakers-build/bb-review-ticket` in a review subagent with the recipe's review method; run `@bakers-build/bb-verify-tests` only for the chosen checks. Use its returned verdict and findings.
4. Repair the closed list in this parent (*Review's closed repair list*), re-run the affected
   checks, and publish the new evidence.
5. Aggregate [result records](results.md) and render once (`@bakers-build/bb-run-outtake`), reusing the persisted MR link and
   distinguishing reused, agent and human observations. Retain the full verdict, evidence and
   walkthrough in the typed review handoff. Print it in full in the terminal
   (`@bakers-build/bb-run-outtake` › *Input contract*).
6. Take the human's confirmation of the verdict.
7. The credentialed parent publishes the typed verdict through `@bakers-build/bb-publish-comment` and one
   `summary`, with any supplied measurement, before origin publication and transition. Follow
   `@bakers-build/bb-workflow` completion order, including a blocked or state-restricted run.
8. On `OK`: obtain or reuse explicit merge authorization, run the merge gate `@bakers-build/bb-merge-mr` with the
   ticket's `identifier` once, including its *Caller handoff*, and transition to `done`
   **only after a verified merge** — a failed gate leaves the ticket in review with the concrete next action.

   On `Not OK`, use the causes from `@bakers-build/bb-review-ticket` › *The verdict*. With **no `criterion`**,
   transition once to `working`, no merge, for a finding **outside** the closed repair list, named.
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
