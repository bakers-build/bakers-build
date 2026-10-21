---
name: create-spec
description: Own the code feature or chore specification step, publishing the complete spec, plan, and verification plan in the ticket for one scope approval.
when:
  work_type: code
  workflow: [bb_feature, bb_chore]
  step: spec
work_type_term:
  name: "work:code"
  description: "Sub-work: code change validated by the e2e test suite."
---

# Specify code work

## spec

1. Read all context with `@bakers-build/read-ticket`; run `@bakers-build/ensure-qualification`. Continue only
   on `qualified`. Read `@bakers-build/method-context` and the project standards; resolve the method
   under *Selecting the skill set*.
2. Invoke the selected specification method with bakers.build as the tracker and this ticket as target.
   Supply its acceptance criteria, existing repository boundaries, and project setup context.
3. Publish complete `spec`, `plan`, and `test` bodies through `@bakers-build/publish-comment` under
   `@bakers-build/method-context` › *Tracker context and confirmed scope* and
   *Project checks and functional validation*. Produce no implementation.
4. Only the last matching owner aggregates every sub-work and publishes and prints
   `@bakers-build/run-outtake` under `@bakers-build/workflow-step`.
5. The last matching work type then obtains one approval covering the proposal,
   records the confirmed comment IDs, and transitions once to `coding` through
   `@bakers-build/transition-ticket` unless the user restricted this run to spec. Reuse
   approval already given for this scope. Stop before coding.
