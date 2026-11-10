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

The definitions live beside the `bb-verdict` skill in `.claude/skills/bakers-build/skills/bb-verdict/measurements/definitions/`, and `schema.json` there validates a definition. Four ship:

| Definition | Rows | Written |
|---|---|---|
| `job_rating` | `job_rating.score`, the human's integer rating of the delivered work, 1 to 5, higher is better | When a human closes a feature, bug or chore ticket as done and gives a rating, just before the terminal state write. No answer means no row, never zero. The ticket also gets the `retro` label. |
| `review_quality` | `score` (0 to 5), `defects_found` (count), `rework_bounces` (count), `coverage_delta` (ratio) | By the credentialed parent of a review, before the verdict transition; the `bb-verdict` subagent itself only returns values. |
| `spec_quality` | `score` (0 to 5), `ac_coverage` (ratio), `risk_clarity` (0 to 5), `open_questions` (count) | Defined as a worked example; nothing in the shipped workflow writes it yet. |
| `mr_changes` | `score` (added + deleted lines), `files_changed`, `additions`, `deletions` | The conductor records the merge-request diff when cleaning up a done ticket with an MR. Binary files count as files and zero lines. |

A definition may name a `label_term`, an existing label added to the ticket as visible provenance; one without it adds no label. To add a definition, drop a JSON file that matches `schema.json` with exactly one value named `score`, unique value names, and an existing `label_term` if you name one. No code changes are needed.

## Write a measurement

Choose a measurement definition and supply every declared numeric value, with no extra values. The measurement skill validates that contract before calling `bakers_metric_write`. The tool replaces only rows under `<name>.`, preserves other rows and labels, and optionally adds the named label. Record the measurement before transitioning the ticket, because the run then loses its write scope.

From a shell, write the arguments to `metric.json`:

```json
{
  "ticket": "<identifier>",
  "name": "job_rating",
  "rows": [{ "name": "job_rating.score", "value": 4 }],
  "label": "retro"
}
```

```sh
bakers tools tool_api__bakers_metric_write --schema
bakers tools tool_api__bakers_metric_write --data @metric.json
```

`--schema` shows the exact row shape the server accepts. `label` is the definition's `label_term`; leave it out for a definition without one. The result lists every metric row of the ticket. See [bakers tools](/cli/tools) for exit codes; a write that ended with exit `5` may have been applied, so read the ticket back before trying again.

Re-measuring keeps no history in the field. Preserve an earlier measurement in a comment if you need its history; run footprints are separate cost measurements. A human can also edit the metrics on the ticket's edit form, which has a Metrics widget.

Who may write: the caller must have ticket and field write access, or an active session covering this ticket. Adding a label also checks label/term access. The metric tool does not bypass those permissions.

**Verify:** read the ticket with `bakers_ticket_read`; expect the new namespace and unchanged unrelated rows.

## Read and aggregate in Views

The Views handlers are keyed on the field type, so any `bb_metric` field inherits them. In a view on tickets:

- The `bb_metric` field shows one metric's `value`, pinned by its `metric_name` option, and can be aggregated, for example with `AVG`.
- The `bb_metric_value` sort orders by that metric's value.
- The `bb_metric_value` filter compares the named metric's value, for example `review_quality.score < 3`, and can be exposed.
- The `bb_metric_name` filter scopes a view to one metric name before aggregating, and can be exposed.

Metrics are separate from the statistics measurements under `/admin/bakers/config/statistics/measurements`, which aggregate tickets and runs.
