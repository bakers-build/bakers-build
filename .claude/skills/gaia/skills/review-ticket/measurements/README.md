# Reusable ticket-measurement definitions

Canonical, reusable **measurement definitions** consumed by the GAIA ticket skills (folded into
`review-ticket`; any skill may compose them). A skill picks a named definition and writes its
result — in a **fixed, deterministic format** — into the existing `gaia_ticket.metrics` field,
instead of inventing metric names or measuring rules of its own.

**Zero code, zero new dependency, zero new permission.** The field (`gaia_ticket.metrics`,
multi-value `gaia_metric` `{name, value, unit?, recorded?}`) and the write path already
exist. Validation is layered where it already lives: `schema.json` validates
the definitions, `gaia dropsh`/Drupal validates the write.

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
- **`label_term`** (optional) — the name of an existing `gaia_labels` taxonomy term, assigned to
  the ticket on measure as human-visible provenance. **Omit it** when the namespaced metric name
  (`<id>.score`) already identifies the origin — e.g. a sub-work measurement whose ticket already
  carries the `work:*` label. When omitted, no term is assigned and none needs seeding.
- **`values[]`** — a fixed, **ordered** set of numeric values. Different definitions may fix
  different value sets. Exactly one value is named **`score`** (mandatory, numeric). Each value
  carries `name` + `label` (required) and optional `description` / `unit` / `min` / `max` /
  `direction` (`up` = higher better, `down` = lower better, `neutral` = informational).

`schema.json` is the normative shape. `definitions/spec-quality.json` and
`definitions/review-quality.json` are two worked examples with **different** value sets — both
contain `score`, but `spec_quality` also fixes `ac_coverage`/`risk_clarity`/`open_questions`
while `review_quality` fixes `defects_found`/`rework_bounces`/`coverage_delta`.

## Fixed output format

The mapping definition → `gaia_metric` rows is deterministic and always the same shape. Each
value becomes exactly one row, with the **namespaced** name `<id>.<value_name>`:

```json
{ "name": "<id>.<value_name>", "value": "<value-to-4-decimals>", "unit": <unit|null>, "recorded": <unix-seconds> }
```

- `value` is the number formatted to exactly 4 decimals as a string, e.g. `4` → `"4.0000"`,
  `4.5` → `"4.5000"`, `0.15` → `"0.1500"` (maps to `gaia_metric.value` `decimal(12,4)`).
- `unit` is the value's `unit` from the definition, or `null`.
- `recorded` is one shared unix-seconds timestamp for the whole measurement.

The **namespace prefix is what keeps two definitions' `score` distinct** (`spec_quality.score`
vs `review_quality.score`) and makes re-measures replace deterministically.

## Validation — you do NOT hand-roll a validator

Two existing layers cover it:

1. **`schema.json` validates the definition.** Any JSON-Schema validator (draft 2020-12) checks
   a definition file — required keys, id/name patterns, exactly-one-`score`, no unknown value
   properties. E.g. from this directory:
   `npx --yes ajv-cli@5 validate --spec=draft2020 -s schema.json -d "definitions/*.json"`.
2. **`gaia dropsh` / Drupal validates the write.** The PATCH is checked against the
   `gaia_metric` field schema (numeric `decimal(12,4)`, field shape); a bad value returns a clear
   422 and nothing is written.

`@gaia/record-measurement` owns validation of supplied rows against the selected definition.

## Provenance

When a definition declares a **`label_term`**, measuring additionally assigns that (existing,
pm-provisioned) `gaia_labels` term to the ticket via `labels`, so the ticket visibly carries the
measurement's identity — the human label alongside the machine namespace. **When the definition
omits `label_term`, this step is skipped** — the namespaced metric name (`<id>.score`) is the
identity, and nothing needs seeding. Prefer omitting it for a sub-work measurement whose ticket
already carries the `work:*` label.

## Update / history semantics

Re-measuring the **same** definition **replaces** its namespaced rows in one read-modify-write:
drop every current row whose `name` starts `<id>.`, write the fresh set with a new `recorded`.
Foreign definitions' rows are untouched. This is duplicate-free by construction — there is never
an ambiguous second `<id>.score`. Prior-value **history** lives in the ticket comments /
footprint, not in the field.

## How to run a measurement

A measurement is a read-modify-write of BOTH `metrics` (attribute) and `labels` (relationship)
in ONE PATCH — only the chosen definition's own namespace is replaced, foreign rows
and existing labels are preserved.

**`@gaia/record-measurement` owns that write and carries its command.** This document owns the
definitions, the fixed output format, and the authoring rules; it names no command. The caller:

1. **Picks** a definition (`definitions/<id>.json`) and supplies its declared values.
2. **Builds** the fixed-format rows: drop the definition's old `<id>.` namespace, append one row
   per declared value with a shared `recorded`.
3. **Invokes** `@gaia/record-measurement` with the ticket UUID, the definition id, and those rows.
   It resolves the `label_term` when the definition declares one, skips the label write entirely
   when it does not, and sends the single PATCH.

The credentialed parent records any supplied `review_quality` measurement before the verdict
transition; `review-ticket` returns values only. A retired run loses its write scope.
`mr_changes` is the exception: the conductor records it itself when it reaps a done ticket that
has an MR, before the worktree is torn down.

## How to add a new definition

1. Drop a `definitions/<id>.json`, named in kebab case (`mr-changes.json` for `mr_changes`),
   matching `schema.json` (one `score`, ordered numeric values).
   **Value `name`s must be unique within the definition** — a duplicate name would emit two rows
   with the same `<id>.<name>`, the exact ambiguous duplicate the namespace exists to prevent.
   (The schema cannot express per-name uniqueness; it is an authoring rule the caller checks.)
2. If the definition declares a `label_term`, ensure it **exists** in the `gaia_labels` taxonomy
   (pm-provisioned) — no permission is invented for a missing term. Omit `label_term` to avoid the
   dependency when the namespace already identifies the measurement.
3. Validate it against the schema (validator command above). A definition that does not match
   `schema.json` is rejected.

No code changes — the fixed output format and the write payload already cover every definition.
