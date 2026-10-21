---
name: docs-authoring
description: Own spec, coding, and review for documentation and reusable agent instructions, with proportional project checks.
when:
  work_type: docs
  workflow: [gaia_feature, gaia_bug, gaia_chore]
  step: [spec, diagnose, coding, review]
work_type_term:
  name: "work:docs"
  description: "Sub-work: documentation / skill-instruction change validated by proportional doc/frontmatter/workflow checks — no runtime surface."
---

# Documentation and instructions

Read and apply `@gaia/method-context` and `@gaia/workflow-step` for the current step.
Documentation has no application runtime by default; provision only when a selected check needs it.

## spec

1. Read all ticket context through `@gaia/read-ticket`, then run `@gaia/ensure-qualification`.
   Continue only on `qualified`. Resolve the method under
   `@gaia/method-context` › *Selecting the skill set*.
2. Invoke the selected specification method with the requested documentation scope. Apply the
   ticket-persistence and verification-plan contract in `@gaia/method-context`; record complete
   `spec`, `plan`, and `test` comments via `@gaia/publish-comment`.
3. The last matching owner aggregates every sub-work and publishes and prints
   `@gaia/run-outtake` under `@gaia/workflow-step`. The last matching work type then
   obtains one approval covering all sub-works, records the confirmed comment IDs,
   and transitions once to `coding` unless the user restricted the run to spec.
   Stop before implementation.

## diagnose

1. Read complete context through `@gaia/read-ticket`; run `@gaia/ensure-qualification` and continue
   only on `qualified`. Frame RED with `@gaia/run-intake`.
2. Apply the selected diagnosis method through `@gaia/diagnose-ticket` to the document/instruction
   defect. Inspect existing checks and record a proportional failing example and complete test
   plan. Provision no application stack unless the confirmed check actually requires it.
3. Each owner publishes its diagnosis and test plan. The last matching owner
   aggregates all results and publishes and prints `@gaia/run-outtake` under
   `@gaia/workflow-step`. It then obtains or reuses approval across sub-works
   and records confirmed scope IDs.
4. The last matching work type transitions once to `coding` through `@gaia/transition-ticket`,
   unless the user restricted this run to diagnose. Stop before implementation.

## coding

Follow `@gaia/method-context` › *Coding flow*, ending at
`@gaia/method-context` › *Coding gate*.

Load the applicable instruction-writing skill from the selected method and matching
`WORKFLOW.md` `Skills` rows. Keep linked templates and generated/copied instructions
consistent. Use proportional documentation checks; a behavioral skill change also needs
the actual isolated worker evidence selected in the plan. Prose checks alone do not
establish worker behavior. `work:docs` contributes no destination of its own.

## review

Follow `@gaia/method-context` › *Review flow*. Tail: `work:docs` **provisions nothing** — reuse
coding's evidence, run only the proportional doc checks a chosen rerun needs, and require no
application environment.
