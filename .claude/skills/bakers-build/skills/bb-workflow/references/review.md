# Review

Every `review` state runs this flow. The recipe's slots name the review method, never the steps.

## read

Make the *review* comment call of [read ticket](read-ticket.md), then resume the confirmed scope,
the persisted MR link and coding's environment and evidence.

## provision

Apply the frame's *Provision* rule only when a chosen check needs a running environment
or logins; issue fresh login links.

## work

Apply `@bakers-build/bb-verdict` › *Reuse evidence*. Invoke `@bakers-build/bb-verdict` in a review
subagent with the slot's review method; use its returned verdict and findings. Repair the closed
list in this parent ([boundaries](boundaries.md) › *Review's closed repair list*).

## validate

Run [verify](verify.md) only for the chosen checks and for the checks a repair affects; record the
new evidence under [result records](results.md).

## deliver

none — the merge belongs to *transition*.

## outtake

Aggregate the result records and render once through [the outtake](outtake.md), reusing the MR link
and distinguishing reused, agent and human observations; print it in full. Take the human's
confirmation of the verdict; an unattended run has none to wait for. Then the credentialed parent
publishes the typed verdict through [publish comment](publish-comment.md) — full verdict, evidence
and walkthrough — and the rendered outtake as its own `summary` comment, with any supplied
[measurement](measurement.md), before origin publication and transition. A blocked or
state-restricted run publishes both too.

**The verdict comment carries its result on one line.** Publish it in type `review`, with
`Status: **OK**` or `Status: **Not OK**` on a line of its own. The [coding gate](coding-gate.md) ›
*Re-entry exception* reads that line, so its wording is a contract rather than a house style.

## transition

On `OK`: obtain or reuse explicit merge authorization, run [merge](merge.md) with the ticket's
`identifier` field once, including its *Caller handoff*, and transition to `done` **only after a
verified merge** — a failed gate leaves the ticket in review with the concrete next action.

On `Not OK`, use the causes from `@bakers-build/bb-verdict` › *The verdict*. With **no
`criterion`** cause, transition once to `working`, no merge, for a finding **outside** the closed
repair list, named. If any failing criterion carries the cause `criterion`, hold in `review`:
present the causes and proposed rewrite, and take the operator's decision before proceeding. This
also holds a mixed verdict; never route it to qualification automatically. An **unattended** run
stops with its verdict and summary published, as at the coding gate.

On an authorized transition, publish [origin status](origin-status.md) before the final
[state write](transition-ticket.md) and STOP. On a hold, report it without changing the state.
