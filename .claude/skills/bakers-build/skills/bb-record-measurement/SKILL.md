---
name: bb-record-measurement
description: Write one named measurement definition's rows into a bakers.build ticket's metrics field, replacing only that definition's namespace and preserving foreign rows and existing labels.
---

# Record a measurement

Own the measurement write. The caller supplies the ticket UUID, the chosen definition, and its
computed values; this capability replaces that definition's namespace in `bb_ticket.metrics`,
optionally unions the definition's `label_term` onto `labels`, and performs one PATCH.
The definitions, their fixed output format, and the authoring rules live in the reference beside
`@bakers-build/bb-review-ticket` (`measurements/README.md`).

Before writing, check the caller's rows against the chosen definition: every declared value present,
each value numeric, and no value the definition does not declare. A violation is surfaced to the
human and never written.

```bash
TICKET_UUID=<the caller-supplied ticket uuid>
DEFINITION=<the definition id, e.g. review_quality>
LABEL_TERM=<the definition's label_term, e.g. retro for job_rating; empty when omitted>
ROWS=<JSON array of fixed-format bb_metric rows for this measurement>

CURRENT=$(bakers dropsh read "bb_ticket/bb_ticket/$TICKET_UUID")

METRICS=$(jq -n --argjson cur "$(echo "$CURRENT" | jq '.data.attributes.metrics // []')" \
  --argjson add "$ROWS" --arg ns "$DEFINITION." \
  '[ $cur[] | select(.name | startswith($ns) | not) ] + $add')

# A PATCH REPLACES a relationship, so every label already on the ticket is
# re-sent; repeating --labels accumulates on a multi-valued relationship.
KEEP=()
while IFS= read -r uuid; do KEEP+=(--labels "$uuid"); done \
  < <(echo "$CURRENT" | jq -r '.data.relationships.labels.data[]?.id')

LABEL_ARGS=()
if [ -n "$LABEL_TERM" ]; then LABEL_ARGS=(--label_names "$LABEL_TERM"); fi
bakers dropsh update "bb_ticket/bb_ticket/$TICKET_UUID" \
  --json metrics="$METRICS" "${KEEP[@]}" "${LABEL_ARGS[@]}"
```

`metrics` is an array of objects, so it travels as `--json metrics=…`; the `jq` above computes the
namespace replacement. The definition's `label_term` is named, not looked up: `--label_names` unions
it onto the labels being re-sent — [ticket writes](../bb-workflow/references/ticket-writes.md) › *References are named, not resolved*.
The write is schema-validated on the way out; never use `--no-validate`, and stop and fix the
parameters when validation rejects them.

Set the variables in the same shell call as the write; do not use `$BB_ID`, whose absence
collapses the target and fails silently. When the definition declares no `label_term`, drop
`--label_names` and send `metrics` plus the preserved labels only.

Record the measurement **before** any state write: a transition retires the run, and a retired run
loses its write scope.

The observable result is the written namespace. This capability chooses no destination, publishes no
comment, and transitions nothing.
