---
name: workflow-step
description: Use when executing or authoring bakers.build lifecycle steps, evidence and routing contracts, validated writes, or the prior-art policy for creation, qualification and building.
---

# Workflow contract

`WORKFLOW.md` loads lifecycle owners and project policy. Each owner executes only its current
`work_type`/`workflow`/`step` match. For authoring or validating selectors, bundles and inputs,
read [the authoring contract](references/authoring.md).

## Every transition leaves a handoff and a summary

Complete authorized work → publish typed evidence and one aggregated `summary` → print it (`@bakers-build/run-outtake`) → required
confirmation → optional measurements → authorized origin publication → `@bakers-build/transition-ticket`
state write and readback → STOP. The state write retires the run; nothing follows it.

Spec publishes complete `spec`, `plan`, `test`. Coding/review retain complete criteria,
commands, results, revisions and rationale, including blocked or state-restricted runs.
`@bakers-build/run-outtake` renders once after all sub-works; the parent uses `@bakers-build/publish-comment`.
`handoff_comments` holds non-summary comments; `summary_comment` is the newest summary.

**Summary-only exceptions:** `pre_deployment`, `post_deployment`, and verification `summary`
retain complete domain evidence in their single summary. `verifying` publishes per-ticket results,
a tested-set handoff and summary. Compact rendering cannot discard evidence without another record.

## Multi-work single transition

Run matching owners in `WORKFLOW.md` load order. Each supplies its work and evidence using
[the result contract](../method-context/references/results.md). The last matching owner aggregates
one outtake and performs one confirmation and transition, gated on all sub-works.

## Helper skills route nothing

Helpers return results. `@bakers-build/ensure-qualification` alone owns recovery to qualification;
`@bakers-build/create-ticket` owns initial routing. Bundles declare `## Loaded skills`, no `when` or step.

## Common initial prompt

Read complete current-step context through `@bakers-build/read-ticket`. Load subskills only when the current
step or selected tool needs them. Ask for an unresolved tool choice; load only the selected tool.

## Prior art

Before creation and every qualification, execute [prior-art search](references/prior-art-search.md).
Before building, method-context checks the remote base. Qualification and `@bakers-build/merge-mr` also
execute that [check](../method-context/references/prior-art-build.md).
A hit requires a human decision; no label exempts it.

## Handoffs and ticket text are Markdown

Store Markdown source in `body.value` or a ticket's `description.value` with `format: bb_rich`.
Inspect headings, lists, links and tables before writing. Raw HTML is stripped. `bb_comment_type`
is separate from the text format. Verify exact stored text and format on readback;
`@bakers-build/publish-comment` confirms comments by their create response.

### Validated writes and uncertain outcomes

Keep outgoing schema validation enabled. Discover writable fields with `--fields`; use
body file → field parameters → live. Use supported data-file input for bodies exceeding argv limits.
Retain created UUIDs immediately. Reconcile uncertain writes by UUID or uniquely matching context;
never blindly repeat the create. Correct confirmed pre-send rejection before retrying.

Verify state readback. On definite rejection retain state and best-effort restore mapped origin
status while authorized; on uncertain outcomes reconcile first. Report unreconciled mismatches.

## References are named, not resolved

Use schema-supported name flags. Environment names require project scope. Verify resolved
relationships, not input-only flags. PATCH replaces relationships; preserve existing members.
Clear nullable references only through supported normal validation.

## Skill prose cites no ticket identifiers

Apply `WORKFLOW.md` › *Standards*.
