---
name: run-intake
description: Render a concise framing of a GAIA state run with its ticket, sub-works, confirmed plan, target gate, and resumed inputs.
---

# Frame the run

Right after `@gaia/read-ticket`, present a short framing of the run: what it will do, which inputs
it resumes, and which gate it must reach. This helper owns presentation only; it writes no data;
step owners keep facts, artifacts, validation, confirmation, transitions, and STOP behavior.

## Input contract

Fill these fields inline; write nothing to storage:

| Field | Meaning |
|---|---|
| `state` | the workflow state about to run |
| `ticket` | identifier and title |
| `sub_works` | detected `work:*` sub-works; an explicit label wins, otherwise infer the applicable sub-works and record the inferred result |
| `plan` | one line per sub-work: selected test/path or build then validate |
| `gate` | `RED` at diagnose, `GREEN` at coding, `OK`/`Not OK` at review |
| `inputs` | confirmed handoff or PM-seeded acceptance criteria being resumed |

## Rendering order

Lead with the headline: state, ticket, plan, and target gate. Then render sub-works, selected
test/path and validation, and resumed inputs. The final handoff is rendered separately by `@gaia/run-outtake`. Omit empty sections. Suppress the execution diary by default; surface it only
for a failed, skipped, constrained, or human action that is material.

Keep supporting context concise and inline with the relevant material section; do not add a second
summary format.

At review, include the resolved MR link persisted by the coding transition; the same durable link
survives the state change.

Use the intake order above. Render the caller's selected work,
validation, leading evidence and key artifacts for every applicable sub-work. This helper selects no
plan, invokes no sub-skill and writes no data or destination.
