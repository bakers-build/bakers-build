---
title: Ticket metrics
description: The metrics field on a bakers.build ticket - its shape, the namespaced measurement definitions that ship, how rows are written and replaced, and how to read and aggregate them in Views.
---

# Ticket metrics

`bb_ticket.metrics` is a multi-value field of named numbers that records how well a ticket went, the success side that complements the run footprint (tokens, duration and turns), which measures the cost of a run.

## Shape

Each value of the field is a row with four columns:

| Column | Type | Notes |
|---|---|---|
| `name` | string, up to 64 characters | Required. Free text, never a configured list, so a new metric needs no schema change. |
| `value` | decimal(12,4) | Required. Exact for counts, ratios and hours; JSON:API carries it as a string such as `"4.0000"`. |
| `unit` | string, up to 32 characters | Optional label such as `ratio` or `count`. |
| `recorded` | UNIX timestamp | Optional. |

Leave `unit` and `recorded` out when they are empty. Never send `recorded` as an explicit `null`: Drupal core's timestamp normalizer answers 500 for it.

## Measurement definitions

Names are a convention, not a schema, so agreeing on them keeps metrics comparable. The convention is a namespace: a measurement definition has an `id` and a fixed, ordered set of numeric values, and each value becomes one row named `<id>.<value>`. The namespace keeps `spec_quality.score` and `review_quality.score` apart and makes a re-measure replace its own rows deterministically.

The definitions live beside the `bb-review-ticket` skill in `.claude/skills/bakers-build/skills/bb-review-ticket/measurements/definitions/`, and `schema.json` there validates a definition. Three ship:

| Definition | Rows | Written |
|---|---|---|
| `job_rating` | `job_rating.score`, the human's integer rating of the delivered work, 1 to 5, higher is better | When a human closes a feature, bug or chore ticket as done and gives a rating, just before the terminal state write. No answer means no row, never zero. The ticket also gets the `retro` label. |
| `review_quality` | `score` (0 to 5), `defects_found` (count), `rework_bounces` (count), `coverage_delta` (ratio) | By the credentialed parent of a review, before the verdict transition; `bb-review-ticket` itself only returns values. |
| `spec_quality` | `score` (0 to 5), `ac_coverage` (ratio), `risk_clarity` (0 to 5), `open_questions` (count) | Defined as a worked example; nothing in the shipped workflow writes it yet. |

A definition may name a `label_term`, an existing label added to the ticket as visible provenance; one without it adds no label. To add a definition, drop a JSON file that matches `schema.json` with exactly one value named `score`, unique value names, and an existing `label_term` if you name one. No code changes are needed.

## Write a measurement

The `bb-record-measurement` skill owns the write, and workflows call it instead of patching the field themselves. It checks that the rows match the chosen definition (every declared value present, each numeric, none undeclared) and never writes a violation. It then reads the ticket, drops every current row whose name starts with `<id>.`, appends the fresh set, keeps foreign rows and existing labels, and sends one update. Record the measurement before any state write: a transition retires the run, and a retired run loses its write scope.

The same shape from a shell looks like this. The field is a multi-value array, so a write replaces the whole array and you must send the rows you want to keep:

```sh
bakers dropsh read bb_ticket/bb_ticket/<uuid>
bakers dropsh update bb_ticket/bb_ticket/<uuid> --dry-run \
  --json metrics='[{"name":"job_rating.score","value":"4.0000","recorded":1789766400}]'
```

The first command prints the current `metrics` under `data.attributes`. Drop `--dry-run` to send the update for real, and never use `--no-validate`. To add a `label_term`, name it with `--label_names` and resend every existing label as a repeated `--labels <uuid>`, because an update replaces a relationship.

Re-measuring keeps no history in the field; earlier values live in the ticket comments and the run footprint. A human can also edit the metrics on the ticket's edit form, which has a Metrics widget.

Who may write: an agent or conductor session can update `metrics` on an in-scope ticket with no extra permission, because the field follows ordinary ticket field access.

## Read and aggregate in Views

The Views handlers are keyed on the field type, so any `bb_metric` field inherits them. In a view on tickets:

- The `bb_metric` field shows one metric's `value`, pinned by its `metric_name` option, and can be aggregated, for example with `AVG`.
- The `bb_metric_value` sort orders by that metric's value.
- The `bb_metric_value` filter compares the named metric's value, for example `review_quality.score < 3`, and can be exposed.
- The `bb_metric_name` filter scopes a view to one metric name before aggregating, and can be exposed.

Metrics are separate from the statistics measurements under `/admin/bakers/config/statistics/measurements`, which aggregate tickets and runs.
