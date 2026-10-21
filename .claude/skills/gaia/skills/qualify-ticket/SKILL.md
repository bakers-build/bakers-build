---
name: qualify-ticket
description: "Own qualification: check prior art, classify work, confirm an acceptance-first handoff, and route once."
when:
  workflow: [gaia_feature, gaia_bug, gaia_chore]
  step: [qualification]
---

# Qualify a ticket

## Run flow

Execute only qualification, then STOP.

1. Read complete context with `@gaia/read-ticket`. Execute
   [prior-art search](../workflow-step/references/prior-art-search.md). On a hit, publish nothing,
   transition nothing; report identifier, title, state, assignee and available MR/merge, and ask
   whether to continue, combine or close. Close is a `@gaia/transition-ticket` write to
   `cancelled`, never a direct `closed` field write. Retain searched terms and negative evidence.
   Run step 1's ticket searches, and its probe when a search is empty, before any Git call:
   in sequence, never in parallel.
2. Run the [remote base check](../method-context/references/prior-art-build.md).
   On `prior_art_hit`, apply step 1’s stop and decision; an unresolved error also stops publication.
   Retain both ticket-search and base-check evidence in the qualification handoff and summary.
3. Resolve the method under `@gaia/method-context` › *Selecting the skill set*; frame the run with
   `@gaia/run-intake`. Infer all applicable sub-works; explicit `work:*` labels win.
4. Ensure the declared work-type terms; apply `@gaia/acceptance` › *Gate each criterion before
   publishing it*. Clarify actors and access under [result records](../method-context/references/results.md):
   reuse known choices, ask which environment/role/account should be tested and whether denied or
   anonymous paths matter. Persist answers and unresolved choices; actor wording alone is insufficient.
5. Apply *Propose an agent* below. Publish one complete `qualification` handoff through
   `@gaia/publish-comment`, retaining searched terms, evidence and the fields below.
6. Aggregate sub-work results; present and publish `@gaia/run-outtake` once. Obtain or
   reuse approval of the qualification handoff.
7. The last matching owner publishes authorized origin status via `@gaia/publish-origin-status`
   and performs one final `@gaia/transition-ticket`: feature/chore → `spec`, bug → `diagnose`.
   STOP without starting the destination step.

## Visible handoff

The typed qualification handoff records Outcome, Acceptance, Out of scope, then Handoff metadata.
Acceptance includes stable AC IDs and the quality gate's passed/rewritten tally, previous wording
for rewrites and explicit assumptions. Quality-gate approval is not a passed implementation test.
`@gaia/run-outtake` alone owns the visible summary; retain complete criteria in this typed record.

Required fields:

- `acceptance_criteria`: exhaustive actor-named, checkable conditions.
- `out_of_scope`: explicit boundary, including a reasoned none.
- `ticket_type`, `workflow`, applicable `work:*` labels.
- `reproduction`: bug condition, otherwise `not_required`.
- `scenario_required`: whether confirmed runtime behavior needs a browser path.
- `review_actors`: role/account/environment choices, source and resolution status per result records.
- `handoff_version`: monotonically increasing; requalification supersedes older versions.
- `provenance`: hash of title, description, labels and ticket revision.

## Classify work types

Read selection rules from loaded owners' `work_type_term`; use taxonomy-driven classification.
Idempotently create missing terms in `gaia_labels` (`--bundle gaia_labels`) with their descriptions.
Supply `--workspace_id "$GAIA_WORKSPACE_ID"`; obtain it with `gaia info` when unset.

## Propose an agent

When evaluating agent routing during qualification, read [agent choice](references/agent-choice.md).
Preserve confirmed choices. Unattended runs recommend but write no agent label; failed catalog
lookup leaves existing defaults in force. Method selection follows method-context.
