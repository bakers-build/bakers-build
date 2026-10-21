---
name: ddev-drupal-bug
description: Own diagnosis, coding, and review of a code bug using original preset methods and project-configured checks.
when:
  work_type: code
  workflow: gaia_bug
  step: [diagnose, coding, review]
work_type_term:
  name: "work:code"
  description: "Sub-work: code change validated by the e2e test suite."
---

# Code bug

Read and apply `@gaia/method-context` and `@gaia/workflow-step` for the current step.
Use `@gaia/resolve-environment` before selected checks to establish configured runtime and
access, including CLI-only or no-runtime checks and qualification's complete actor set.

## diagnose

1. Read all context with `@gaia/read-ticket`, then run `@gaia/ensure-qualification`.
   Continue only on `qualified`. Frame the RED gate with `@gaia/run-intake`.
2. Invoke `@gaia/diagnose-ticket` with the selected diagnosis method and publish acceptance
   through `@gaia/acceptance` when not already recorded. Record the actual failing observation.
3. The last matching owner aggregates all sub-works, presents and publishes `@gaia/run-outtake`
   under `@gaia/workflow-step`, and obtains one approval of diagnosis,
   fix direction, and verification plan, unless already approved, then transitions once to
   `coding` unless the user restricted the run to diagnose. Stop before fixing.

## coding

Follow `@gaia/method-context` › *Coding flow*, ending at
`@gaia/method-context` › *Coding gate*.

Resume the confirmed diagnosis and regression plan, including the RED test/path and
evidence; reuse that regression at the approved seam to establish GREEN.

## review

Follow `@gaia/method-context` › *Review flow*. Tail: review is **optional** for a bug — `finish`
may leave `coding` or `review`, so an explicitly authorized skip can merge to `done` from `coding`;
when review does run, `done` still comes only through the merge gate on `OK`. Preserve all
actor requirements and reuse valid environment/access records through `@gaia/resolve-environment`.
