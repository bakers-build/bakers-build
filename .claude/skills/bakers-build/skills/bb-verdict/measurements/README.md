# Reusable ticket-measurement definitions

Canonical, reusable **measurement definitions** consumed by the bakers.build ticket skills (folded into
`bb-verdict`; any skill may compose them). A skill picks a named definition and writes its
result — in a **fixed, deterministic format** — into the existing `bb_ticket.metrics` field,
instead of inventing metric names or measuring rules of its own.

**Zero code, zero new dependency, zero new permission.** The field (`bb_ticket.metrics`,
multi-value `bb_metric` `{name, value, unit?}`) and the write path already
exist. Validation is layered where it already lives: `schema.json` validates
the definitions, the `bakers_metric_write` tool validates the write.

```
measurements/
  README.md            ← this guide
  schema.json          ← normative JSON Schema for ONE definition
  definitions/
    spec-quality.json    ← example A
    review-quality.json  ← example B (different value set)
    job-rating.json
    mr-changes.json
```

## What a definition is

A definition is a JSON file conforming to `schema.json`. It declares:

- **`id`** — stable machine id (`^[a-z][a-z0-9_]*$`). This is the metric-name **namespace
  prefix**.
- **`label`** — mandatory human-readable name of the definition.
- **`label_term`** (optional) — a label term name, assigned to the ticket on measure as
  human-visible provenance. **Omit it** when the namespaced metric name
  (`<id>.score`) already identifies the origin — e.g. a measurement whose ticket's
  recipe already identifies it. When omitted, no term is assigned.
- **`values[]`** — a fixed, **ordered** set of numeric values. Different definitions may fix
  different value sets. Exactly one value is named **`score`** (mandatory, numeric). Each value
  carries `name` + `label` (required) and optional `description` / `unit` / `min` / `max` /
  `direction` (`up` = higher better, `down` = lower better, `neutral` = informational).

`schema.json` is the normative shape. `definitions/spec-quality.json` and
`definitions/review-quality.json` are two worked examples with **different** value sets — both
contain `score`, but `spec_quality` also fixes `ac_coverage`/`risk_clarity`/`open_questions`
while `review_quality` fixes `defects_found`/`rework_bounces`/`coverage_delta`.

## Fixed output format

The mapping definition → `bb_metric` rows is deterministic and always the same shape. Each
value becomes exactly one row, with the **namespaced** name `<id>.<value_name>`:

```json
{ "name": "<id>.<value_name>", "value": <number>, "unit": <unit|null> }
```

- `value` is a JSON number (`4`, `4.5`, `0.15`); `bb_metric.value` stores it as `decimal(12,4)`.
- `unit` is the value's `unit` from the definition, or `null`.

The **namespace prefix is what keeps two definitions' `score` distinct** (`spec_quality.score`
vs `review_quality.score`) and makes re-measures replace deterministically.

## Validation — you do NOT hand-roll a validator

Two existing layers cover it:

1. **`schema.json` validates the definition.** Any JSON-Schema validator (draft 2020-12) checks
   a definition file — required keys, id/name patterns, exactly-one-`score`, no unknown value
   properties. E.g. from this directory:
   `npx --yes ajv-cli@5 validate --spec=draft2020 -s schema.json -d "definitions/*.json"`.
2. **`bakers_metric_write` validates the write.** The rows are checked against the tool's input
   schema and the `bb_metric` field (numeric `decimal(12,4)`, field shape); a bad value is refused
   with a clear message and nothing is written.

[measurement](../../bb-workflow/references/measurement.md) owns validation of supplied rows against the selected definition.

## Provenance

When a definition declares a **`label_term`**, measuring additionally adds that label to the ticket by name
(`bakers_metric_write` creates it when missing and the caller may), so the ticket visibly carries
the measurement's identity — the human label alongside the machine namespace. **When the definition
omits `label_term`, this step is skipped** — the namespaced metric name (`<id>.score`) is the
identity. Prefer omitting it when the ticket's recipe already
identifies the measurement.

## Update / history semantics

Re-measuring the **same** definition **replaces** its namespaced rows: `bakers_metric_write`
drops every current row whose `name` starts `<id>.` and writes the fresh set. Foreign
definitions' rows are untouched. This is duplicate-free by construction — there is never
an ambiguous second `<id>.score`. Prior-value **history** lives in the ticket comments /
footprint, not in the field.

## How to run a measurement

A measurement is one `bakers_metric_write` call: the server replaces the chosen definition's
namespace and adds its `label_term`; foreign rows and existing labels are preserved.

**[measurement](../../bb-workflow/references/measurement.md) owns that call**
([tools](../../bb-workflow/references/tools.md)). This document owns the definitions, the fixed
output format, and the authoring rules. The caller:

1. **Picks** a definition (`definitions/<id>.json`) and supplies its declared values.
2. **Builds** one fixed-format row per declared value.
3. **Invokes** [measurement](../../bb-workflow/references/measurement.md) with the ticket UUID, the
   definition id, and those rows. It passes the `label_term` when the definition declares one.

The credentialed parent records any supplied `review_quality` measurement before the verdict
transition; `bb-verdict` returns values only. A retired run loses its write scope.
`mr_changes` is the exception: the conductor records it itself when it reaps a done ticket that
has an MR, before the worktree is torn down.

## How to add a new definition

1. Drop a `definitions/<id>.json`, named in kebab case (`mr-changes.json` for `mr_changes`),
   matching `schema.json` (one `score`, ordered numeric values).
   **Value `name`s must be unique within the definition** — a duplicate name would emit two rows
   with the same `<id>.<name>`, the exact ambiguous duplicate the namespace exists to prevent.
   (The schema cannot express per-name uniqueness; it is an authoring rule the caller checks.)
2. Validate it against the schema (validator command above). A definition that does not match
   `schema.json` is rejected.

No code changes — the fixed output format and the write payload already cover every definition.
