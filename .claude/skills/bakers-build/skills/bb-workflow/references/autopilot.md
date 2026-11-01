# Automatic approval

Read at a confirmation point when `bakers_ticket_read` returns `approval: automatic` for the
ticket's current state. The ticket's workflow declares it per state; `human`, or no `approval`
field, leaves every gate exactly as written.

## What the workflow approves

The workflow gives the one confirmation the gate would otherwise ask a human for, and the run
continues without asking:

| Gate | Confirmation given | Then |
|---|---|---|
| [qualification](qualification.md) › *transition* | approval of the handoff | transition to `plan` |
| [plan](plan.md) › *transition* | the one approval of spec, plan and test (or diagnosis) | record the confirmed IDs, transition to `working` |
| [coding gate](coding-gate.md) | the summary and MR, and the choice of `review` | transition to `review`, also where the slot allows `done` |
| [review](review.md) › *outtake* | the verdict | `Not OK` without a `criterion` cause: transition to `working` |

Record it: each handoff and `summary` published in that state carries the line
`Approval: automatic (workflow <workflow id>)`. Automatic approval also authorizes the
[origin status](origin-status.md) for the destination state. Every readback, publication and STOP
after the transition stays as the gate states it.

## What stays human

Automatic approval covers only the confirmations above. Each of these stops the run as it does under
human approval, with its report published:

- **merge authorization**: after `OK`, ask for it and wait; the ticket stays in `review`, unmerged;
- **a real question** the ticket cannot answer: ask it and wait for the answer;
- a **prior-art hit** or an `error` from a prior-art check;
- a failed, blocked or missing check, so the work is not GREEN;
- a **refused transition**;
- a `criterion` cause in a `Not OK` verdict (review's hold);
- a qualification the [ensure qualification](ensure-qualification.md) guard returns.

## Repair-loop bound

When the ticket already carries two `review` comments with `Status: **Not OK**`, the coding gate
asks the human as written in its steps 1–3; its *Re-entry exception* gives way too. Count the
verdict comments from the ticket read.
