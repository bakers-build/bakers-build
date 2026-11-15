---
name: bb-label-human-review
description: "Use when a ticket labelled `human-review` runs, in any state: carry it to a published review verdict on your own; the reviewer confirms it and authorizes the merge."
---

# Human review

Apply the [label rules](../bb-workflow/references/gates.md#label-rules) first.

The label `human-review` passes every [gate](../bb-workflow/references/gates.md) on its own except
`verdict`, `merge`, `criterion` and recipe gates (`<recipe>:<gate>`): the ticket's reviewer passes
`verdict` and `merge`, a person passes the recipe gates. It authorizes the transitions up to `review` and their origin
status. Decide technical questions yourself and record each decision with its reason under
`Decisions` in the handoff.

Stop with a question naming the missing reviewer at the first state that finds the ticket without
one. A `criterion` stops with a question for the person the label rules name. A choice the confirmed criteria leave to
the user, such as what the result looks like, is no `criterion` here: decide it, record it under
`Decisions`, and leave it to the reviewer at `verdict`; this label asks no acceptance (`result`).
An unplanned risky change ends the run as a technical problem
([gates](../bb-workflow/references/gates.md) › *Risk list*).

| State | The run |
|---|---|
| qualification | approves the criteria and transitions to `plan` |
| plan | approves its spec, plan and test, or the diagnosis, and transitions to `working` |
| working | at a GREEN [coding gate](../bb-workflow/references/coding-gate.md) transitions to `review` |
| review | publishes the verdict; `Not OK` that coding can fix transitions to `working`; `OK` stops and asks the reviewer to confirm the verdict and authorize the merge |

The reviewer's confirmation and merge authorization in a comment newer than the verdict pass
`verdict` and `merge`; then merge under the frame.
