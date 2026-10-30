# Transition a ticket

Read for every link or state write; the state file's `transition` names the destination. Require
the caller-supplied ticket; state changes also require an explicit destination. Re-read the ticket
and validate its current state. Discard unresolved placeholder links. Preserve every existing link,
including human-added CI links; union supplied links by `uri`. Reject newly supplied pipeline/CI
URLs (`/-/pipelines/`, `/pipelines/`, `/-/jobs/`, `/actions/runs/`) before unioning. [Evidence and
links](evidence.md) owns link policy; additive writes never authorize historical deletion.

From `working` onward, written links require a resolved `MR`, matching [outtake](outtake.md).
Failure to resolve one is a run failure, not permission to write a shorter set.

Before eligible `done`/`cancelled` work-ticket decisions, the caller executes
[terminal retrospective](retrospective.md), supplying completed/skipped collection.
Nonterminal transitions do not load it.

## Links-only write

Persist the coding MR before publishing handoff, even when remaining in `working`.
If its URI is already present, verify it and skip the write. Otherwise call
`bakers_ticket_transition` ([tools](tools.md)) with `ticket` and `links`, and **no `state`**: the
current state is no substitute destination. Verify the MR URI and every existing link in the
returned `links`. A failed or uncertain write blocks successful handoff; reconcile before retrying.
This mode invokes no transition, retrospective or origin status.

## State write

Call `bakers_ticket_transition` with `ticket`, `state` set to the caller's destination, and `links`
only when there are links to add. The workflow decides whether the move is allowed; on a refusal,
stop and report it without trying a different state. Infer no destination, confirm no work and
start no subsequent work.

Read back with a separate `bakers_ticket_read` — the transition result is no readback — and verify
destination and preserved links. Reconcile uncertain outcomes under `@bakers-build/bb-workflow`.
