# bakers.build ticket success metrics — candidate catalog (convention)

`bb_ticket.metrics` (BB-172) is a multi-value `bb_metric` field carrying
arbitrary named metrics `{name, value, unit?, recorded?}`. The **primary purpose
is the success side** of a ticket (how well it went), complementing the run
footprint (BB-132), which measures the **cost side** of a run (effort:
tokens, duration, turns).

## The field is generic — names are a convention, not a schema

The metric `name` is a **free string (data)**, never a config allowed-values
list, so a new metric kind needs no schema change (AC-1). The names below are the
**canonical catalog**: agreeing on them keeps metrics comparable and aggregatable
across tickets (AC-3). They are **not enforced** — a typo is simply a distinct
metric — so treat this list as the shared vocabulary, and add to it here when a
new metric earns a home.

`value` is `decimal(12,4)` for exact aggregation across counts, ratios and
hours. `unit` is a free label (`ratio`, `h`, `count`). `recorded` is an optional
UNIX timestamp. **Omit `recorded`/`unit` when empty — do NOT send an explicit
`null recorded` over JSON:API** (core's TimestampNormalizer 500s on a null
timestamp); an absent key is the correct shape.

## Canonical metrics

| name                 | unit    | meaning                                                        | who writes it | when                          |
|----------------------|---------|----------------------------------------------------------------|---------------|-------------------------------|
| `ac_pass_rate`       | ratio   | fraction of acceptance criteria passing in the review fresh run | agent (review) | at review, from the AC matrix |
| `review_bounces`     | count   | number of review→coding loops before done                      | agent/conductor | incremented on each Not-OK bounce |
| `time_to_done_h`     | h       | wall-clock hours from spec entry to done                       | conductor      | at done                       |
| `rework_followups`   | count   | follow-up bugs that reference this ticket after done           | conductor/human | post-done, ongoing            |
| `human_interventions`| count   | manual human corrections/edits per run on this ticket          | conductor/human | during/after a run            |

## Write paths

- **Agent / conductor (session scope):** a JSON:API `PATCH` of `metrics` on an
  in-scope ticket — allowed with **no new permission** (a session write to an
  in-scope ticket already passes `BbTicketAccessControlHandler`; `metrics`
  falls through `checkFieldAccess`). Multi-value → **read-modify-write union**
  (GET current metrics, append, PATCH the whole array), like `links`.
- **Human:** the Metrics widget on the ticket edit form
  (`/admin/bakers/ticket/<id>/edit`).

## Reading / aggregating (Views)

The `bb_metric` Views handlers are keyed on the field **type**, so any
`bb_metric` field inherits them (`bb_ticket.metrics` now; `bb_run.metrics`
later):

- `bb_metric` **field** — renders one metric's `value`, pinned by a
  `metric_name` option (aggregatable, e.g. `AVG`).
- `bb_metric_value` **sort** — `ORDER BY` the named metric's value.
- `bb_metric_value` **filter** — numeric filter on the named metric's value
  (e.g. `ac_pass_rate < 0.5`), exposable.
- `bb_metric_name` **filter** — scope a view to one metric name before
  aggregating (presence/equality), exposable.

## Follow-up (out of scope for BB-172)

- **Derivation/automation** of these metrics (the conductor/agent actually
  computing and writing `ac_pass_rate`, `review_bounces`, … at the right
  lifecycle point) is follow-up work; BB-172 ships the field, write path, and
  Views handlers only.
- A **dashboard widget** surfacing per-project success over time is an optional
  follow-up ticket (the spec deferred it).
- **Footprint merge (Option A):** folding the run footprint into this one
  `bb_metric` model is reachable without rework under the chosen Option B+
  (the field type is reusable on `bb_run`), but is deliberately **not** done
  here — see the BB-172 design doc §6 for the migration path.
