---
name: bb-verdict
description: Review subagent entry — return an independent verdict and findings from confirmed scope, pinned changes and valid evidence.
---

# Review a ticket

Return an independent verdict in a review subagent using confirmed scope, pinned base/head diff,
and coding evidence. The parent owns publication, authorized repairs, merge and routing under
[review](../bb-workflow/references/review.md). This subagent holds no credentials and performs no repair.

## Reuse evidence

Reuse coding evidence/MR/surfaces under [results](../bb-workflow/references/results.md), retaining
revision/scope and reuse reason. Rerun for new changes, failure, missing evidence, unresolved
concerns or explicit request; record why. Transient artifacts may be missing: report limitations
and run necessary checks; never infer a pass. Use [verify](../bb-workflow/references/verify.md),
[browser](../bb-workflow/references/browser.md) and frame Provision for environments/personas.
Human review needs a human observation.

## The verdict

Return `OK` or `Not OK` with each AC result/reason under
[ticket writes](../bb-workflow/references/ticket-writes.md). A bare verdict is a defect.
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
[review](../bb-workflow/references/review.md). The parent alone makes allowed repairs and reruns their checks.

Return findings/results to the parent; [outtake](../bb-workflow/references/outtake.md) owns format.
Choose no state, merge nothing, publish nothing.

## Over-engineering pass

Separately list concrete deletions: location, what to remove, and its existing helper, standard
library, platform feature or simpler replacement. Give net lines removable, or none.
Preserve correctness, security, performance, accessibility and necessary evidence.
Complexity findings alone do not change the verdict to `Not OK`; the human decides whether to act.

Derived from the ponytail skill collection (MIT).
