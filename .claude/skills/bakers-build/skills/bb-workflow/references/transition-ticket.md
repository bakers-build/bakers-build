# Transition a ticket

Require caller ticket/destination; refresh current state under [read ticket](read-ticket.md).
Union links by URI, preserve existing, discard placeholders, reject new pipeline/CI URLs (`/-/pipelines/`, `/pipelines/`, `/-/jobs/`,
`/actions/runs/`). [Evidence](evidence.md) owns policy. From working onward MR is required.
Eligible done/cancelled: first [retrospective](retrospective.md), with completed/skipped collection.

## Links-only write

Before coding handoff persist verified MR, also when staying working; already present: verify/skip.
Else `bakers_ticket_transition` with ticket/links and **no state**. Verify MR and existing links in
result. Failure/uncertainty blocks handoff: reconcile under [ticket writes](ticket-writes.md).
This mode runs no retrospective/origin/transition.

## State write

Call with caller's state and optional added links. Refusal stops; choose no alternate destination
or subsequent work. Separately `bakers_ticket_read` verifies state and preserved links; write result
is not readback. Reconcile uncertainty before retry.
