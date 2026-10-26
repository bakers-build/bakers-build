---
name: bb-run-intake
description: Render a concise framing of a bakers.build state run with its ticket, recipe, confirmed plan, target gate, and resumed inputs.
---

# Frame the run

Right after `@bakers-build/bb-read-ticket`, present a short framing of the run: what it will do, which inputs
it resumes, and which gate it must reach. This helper owns presentation only; it writes no data;
step owners keep facts, artifacts, validation, confirmation, transitions, and STOP behavior.

## Input contract

Fill these fields inline; write nothing to storage:

| Field | Meaning |
|---|---|
| `state` | the workflow state about to run |
| `ticket` | identifier and title |
| `recipe` | the ticket's `recipe` and `ticket_type` |
| `plan` | selected test/path or build then validate |
| `gate` | `RED` at a bug's plan, `GREEN` at working, `OK`/`Not OK` at review |
| `inputs` | confirmed handoff or PM-seeded acceptance criteria being resumed |

## Rendering order

Lead with the headline: state, ticket, plan, and target gate. Then render the recipe, selected
test/path and validation, and resumed inputs. The final handoff is rendered separately by `@bakers-build/bb-run-outtake`. Omit empty sections. Suppress the execution diary by default; surface it only
for a failed, skipped, constrained, or human action that is material.

Keep supporting context concise and inline with the relevant material section; do not add a second
summary format.

At review, include the resolved MR link persisted by the working transition; the same durable link
survives the state change.

Use the intake order above. Render the caller's selected work,
validation, leading evidence and key artifacts. This helper selects no
plan, invokes no sub-skill and writes no data or destination.
