# Establish acceptance criteria

Read at qualification's `work`, and at working's `read` when no `acceptance` comment covers the
confirmed scope. Index criteria and bug reproduction under [ticket writes](ticket-writes.md).
Read the qualification handoff and adopt PM-seeded wording when already checkable, role-named and
benefit-bearing.

Each criterion is a condition another worker can mark met or not met:
“As a <role>, I want <feature>, so that <benefit>.” Cover every implied condition; list length
follows scope, not a fixed number. Assign stable AC IDs.

Reference qualification's unchanged criteria by ID and comment ID; write only added or changed
criteria in full. Preserve PM-seeded and standing criteria. Verification resolves this index.

Include one standing criterion that the change passes every matching `bb-phase-validate`
row of `WORKFLOW.md`. For bugs, also require that the reproducible condition no longer reproduces.

The role names who benefits; the concrete test personas belong to qualification's `test_as`
([result records](results.md) › *Test as*).

## Gate each criterion before publishing it

Check every criterion:

| Defect | Question | Action |
|---|---|---|
| `out of scope` | Is this proportionate to the ticket? | Narrow it to the authorized change. |
| `unsatisfiable` | Can an implementation make it true? | Replace contradictions or external guarantees with achievable behavior. |
| `ambiguous` | Can another person judge it consistently? | Specify input, condition and observable result. |
| `untestable` | What observation decides it? | Name the observation; exact commands belong to the test plan. |

`@bakers-build/bb-verdict` › *The verdict* owns the defect vocabulary. Rewrite supported defects here;
report the previous wording and any assumption. Preserve passing wording exactly. If required
facts are missing, ask or record the unresolved assumption rather than inventing scope.
The gate's passed/rewritten tally evaluates criterion quality, not implementation success.
Qualification's outtake presents it.

Publish the criterion index through [ticket writes](ticket-writes.md) with `bb_comment_type`
**`acceptance`**. Acceptance is validator-neutral: it selects no command, runs no tests, prepares no
scenarios and writes no destination. Return the published comment identifier.
