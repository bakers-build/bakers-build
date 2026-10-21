---
name: review-ticket
description: Return an independent verdict and findings from confirmed scope, pinned changes and valid evidence.
---

# Review a ticket

Return an independent verdict in a review subagent using confirmed scope, pinned base/head diff,
and coding evidence. The parent owns publication, authorized repairs, merge and routing under
`@bakers-build/method-context` › *Review flow*. This subagent holds no credentials and performs no repair.

## Reuse evidence

Reuse coding's durable evidence, resolved MR link and environment surfaces. Preserve the original
revision and scope; mark reused results using [the result contract](../method-context/references/results.md).
Rerun only for new changes, failures, missing evidence, unresolved concerns or an explicit request;
record why. Read available transient output and screenshots. Missing artifacts require an honest
limitation and any necessary fresh check, never a fabricated pass.

Use `@bakers-build/verify-tests` for suite commands, including browser suites; use
`@bakers-build/verify-playwright-cli` for agent browser inspection. Resolve required environments and actors
through `@bakers-build/resolve-environment`. Human review remains pending until a human supplies an observation.

## The verdict

Return `OK` or `Not OK`. Every AC result (`PASS`, `FAIL`, intentional `RED`) includes its reasoning,
command/observation, tested revision and evidence. A bare verdict is itself a review defect.
Any FAIL or RED forces `Not OK`; an uncovered criterion also does unless justified.

Failure causes are closed:

- `implementation`: valid criterion; behavior fails it.
- `criterion`: criterion cannot be satisfied as written.
- `evidence`: valid criterion; observation is missing.

Use `FAIL(<cause>)` or `RED(<cause>)`; an unjustifiably uncovered criterion is `FAIL(evidence)`.
For every finding supply **What** (expected/observed and location), **Why** (evidence-backed cause),
and **Fix** (proposed repair and success check). Say unknown when the cause is unproven.
Distinguish proposed repairs from completed repairs.

A `criterion` cause additionally identifies `out of scope`, `unsatisfiable`, `ambiguous` or
`untestable` and proposes rewritten wording. A fourth cause or omitted rewrite is a verdict defect.
Classification grants no additional repair authority: follow *Review's closed repair list* in
method-context. The parent alone makes allowed repairs and reruns their checks.

The typed verdict keeps full details. Return findings and result records to the parent;
`@bakers-build/run-outtake` owns the visible format and line shape. Choose no ticket state, run no merge,
and publish no comment.

## Over-engineering pass

Separately list concrete deletions: location, what to remove, and its existing helper, standard
library, platform feature or simpler replacement. Give net lines removable, or none.
Preserve correctness, security, performance, accessibility and necessary evidence.
Complexity findings alone do not change the verdict to `Not OK`; the human decides whether to act.

Derived from the ponytail skill collection (MIT).
