---
name: ddev-drupal-feature
description: Own coding and review for a code feature or chore, with original preset methods and project-configured checks.
when:
  work_type: code
  workflow: [bb_feature, bb_chore]
  step: [coding, review]
work_type_term:
  name: "work:code"
  description: "Sub-work: code change validated by the e2e test suite."
---

# Code feature or chore

Read and apply `@bakers-build/method-context` and `@bakers-build/workflow-step` for the current step.
Use `@bakers-build/resolve-environment` before selected checks to establish configured runtime and
access, including CLI-only or no-runtime checks and qualification's complete actor set.

## coding

Follow `@bakers-build/method-context` › *Coding flow*, ending at
`@bakers-build/method-context` › *Coding gate*.

Use the approved feature or chore scope and its selected test seams.

## review

Follow `@bakers-build/method-context` › *Review flow*, including its cause-dependent `Not OK` routing.
Review is mandatory for a feature. Preserve all actor requirements and reuse valid
environment/access records through `@bakers-build/resolve-environment`.
