---
name: ddev-drupal-feature
description: Own coding and review for a code feature or chore, with original preset methods and project-configured checks.
when:
  work_type: code
  workflow: [gaia_feature, gaia_chore]
  step: [coding, review]
work_type_term:
  name: "work:code"
  description: "Sub-work: code change validated by the e2e test suite."
---

# Code feature or chore

Read and apply `@gaia/method-context` and `@gaia/workflow-step` for the current step.
Use `@gaia/resolve-environment` before selected checks to establish configured runtime and
access, including CLI-only or no-runtime checks and qualification's complete actor set.

## coding

Follow `@gaia/method-context` › *Coding flow*, ending at
`@gaia/method-context` › *Coding gate*.

Use the approved feature or chore scope and its selected test seams.

## review

Follow `@gaia/method-context` › *Review flow*, including its cause-dependent `Not OK` routing.
Review is mandatory for a feature. Preserve all actor requirements and reuse valid
environment/access records through `@gaia/resolve-environment`.
