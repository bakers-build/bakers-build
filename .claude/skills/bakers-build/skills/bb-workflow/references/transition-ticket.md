# Transition a ticket

Read for every link or state write; the state file's `transition` names the destination. Require
caller-supplied ticket UUID; state changes also require an explicit destination. Re-read the ticket
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
If its URI is already present, verify it and skip the write. Otherwise list writable fields;
if `links` is unavailable, report failure.

```bash
# Set caller UUID and unioned [{uri,title}] LINKS in this same shell call.
TICKET_UUID=<caller-supplied-uuid>
LINKS=<unioned-array>
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" --fields
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" --json links="$LINKS"
```

Omit `--state`; the current state is no substitute destination. Read back with a separate
`bakers dropsh read "bb_ticket/bb_ticket/$TICKET_UUID"` and verify the MR URI
and every existing link. A failed or uncertain write blocks successful handoff; reconcile before
retrying. This mode invokes no transition, retrospective or origin status.

## State write

Use `field parameters → live`: inspect `--fields`, then name the destination directly.
Include `links` only when writable, as `--json` with `{uri,title}` objects.

```bash
# Set these in the same shell call as the write; never use $BB_ID.
TICKET_UUID=<caller-supplied-uuid>
DESTINATION=<caller-supplied-destination>
LINKS=<unioned-array>
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" --fields

# With links:
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" \
  --state "$DESTINATION" --json links="$LINKS"

# With none, omit the flag; never send --json links=.
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" --state "$DESTINATION"
```

An unset UUID can silently lose the write. Keep schema validation enabled; never use
`--no-validate`. On validation rejection, stop and fix parameters. Report a 422 without retrying
a different state. Infer no destination, confirm no work and start no subsequent work.

Read back with a separate `bakers dropsh read "bb_ticket/bb_ticket/$TICKET_UUID"` — the update
response is no readback — and verify destination
and preserved links. Reconcile uncertain outcomes under
`@bakers-build/bb-workflow`; report rejection without trying a different state.
