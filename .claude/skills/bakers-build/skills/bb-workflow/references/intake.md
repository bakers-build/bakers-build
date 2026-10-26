# Frame the run

Read once by the frame, after routing and the stop rule, before the state file's `read`. Present a
short framing of the run: what it will do, which inputs
it resumes, and which gate it must reach. The intake owns presentation only; it writes no data;
step owners keep facts, artifacts, validation, confirmation, transitions, and STOP behavior.

## Input contract

Fill these fields inline; write nothing to storage:

| Field | Meaning |
|---|---|
| `state` | the workflow state about to run |
| `ticket` | identifier and title |
| `recipe` | the resolved recipe, `ticket_type` and the slot per phase (type, general or none) |
| `hints` | matching `WORKFLOW.md` rows and the runtime guide |
| `test_as` | the personas who test, or `no login needed` |
| `plan` | selected test/path or build then validate |
| `gate` | `RED` at a bug's plan, `GREEN` at working, `OK`/`Not OK` at review |
| `inputs` | confirmed handoff or PM-seeded acceptance criteria being resumed |

## Rendering order

Lead with the headline: state, ticket, plan, and target gate. Then render the recipe, selected
test/path and validation, and resumed inputs. The final handoff is rendered separately by the
outtake. Omit empty sections. Suppress the execution diary by default; surface it only for a failed,
skipped, constrained, or human action that is material.

Keep supporting context concise and inline with the relevant material section; do not add a second
summary format.

At review, include the resolved MR link persisted by the working transition; the same durable link
survives the state change.

Use the intake order above. Render the caller's selected work,
validation, leading evidence and key artifacts. The intake selects no
plan, invokes no skill and writes no data or destination.
