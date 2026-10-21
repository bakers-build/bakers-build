---
name: transition-ticket
description: Write additive resolved ticket links and, when explicitly supplied, a GAIA destination.
---

# Transition a ticket

Require caller-supplied ticket UUID; state changes also require an explicit destination.
Re-read the ticket and validate its current state. Discard unresolved placeholder links.
Preserve every existing link, including human-added CI links; union supplied links by `uri`.
Reject newly supplied pipeline/CI URLs (`/-/pipelines/`, `/pipelines/`, `/-/jobs/`,
`/actions/runs/`) before unioning. `@gaia/essential-skills` owns link policy; additive writes
never authorize historical deletion.

From `coding` onward, written links require a resolved `MR`, matching `@gaia/run-outtake`.
Failure to resolve one is a run failure, not permission to write a shorter set.

Before eligible `done`/`cancelled` work-ticket decisions, the caller executes
[terminal retrospective](references/terminal-retrospective.md), supplying completed/skipped collection.
Nonterminal, deployment and verification transitions do not load it.

## Links-only write

Persist the coding MR before publishing handoff, even when remaining in `coding`.
If its URI is already present, verify it and skip the write. Otherwise list writable fields;
if `links` is unavailable, report failure.

```bash
# Set caller UUID and unioned [{uri,title}] LINKS in this same shell call.
TICKET_UUID=<caller-supplied-uuid>
LINKS=<unioned-array>
gaia dropsh update "gaia_ticket/gaia_ticket/$TICKET_UUID" --fields
gaia dropsh update "gaia_ticket/gaia_ticket/$TICKET_UUID" --json links="$LINKS"
```

Omit `--state`; the current state is no substitute destination. Read back and verify the MR URI
and every existing link. A failed or uncertain write blocks successful handoff; reconcile before
retrying. This mode invokes no transition, retrospective or origin status.

## State write

Use `field parameters → live`: inspect `--fields`, then name the destination directly.
Include `links` only when writable, as `--json` with `{uri,title}` objects.

```bash
# Set these in the same shell call as the write; never use $GAIA_ID.
TICKET_UUID=<caller-supplied-uuid>
DESTINATION=<caller-supplied-destination>
LINKS=<unioned-array>
gaia dropsh update "gaia_ticket/gaia_ticket/$TICKET_UUID" --fields

# With links:
gaia dropsh update "gaia_ticket/gaia_ticket/$TICKET_UUID" \
  --state "$DESTINATION" --json links="$LINKS"

# With none, omit the flag; never send --json links=.
gaia dropsh update "gaia_ticket/gaia_ticket/$TICKET_UUID" --state "$DESTINATION"
```

An unset UUID can silently lose the write. Keep schema validation enabled; never use
`--no-validate`. On validation rejection, stop and fix parameters. Report a 422 without retrying
a different state. Infer no destination, confirm no work and start no subsequent work.

Read back and verify destination and preserved links. Reconcile uncertain outcomes under
`@gaia/workflow-step`; report rejection without trying a different state.
