---
name: bb-qualify-ticket
description: "Own qualification: check prior art, choose the recipe and type, confirm an acceptance-first handoff, and route once."
---

# Qualify a ticket

## Run flow

Execute only qualification, then STOP.

1. Read complete context with `@bakers-build/bb-read-ticket`. Execute
   [prior-art search](../bb-workflow/references/prior-art-search.md). On a hit, publish nothing,
   transition nothing; report identifier, title, state, assignee and available MR/merge, and ask
   whether to continue, combine or close. Close is a `@bakers-build/bb-transition-ticket` write to
   `cancelled`, never a direct `closed` field write. Retain searched terms and negative evidence.
   Run step 1's ticket searches, and its probe when a search is empty, before any Git call:
   in sequence, never in parallel.
2. Run the [remote base check](../bb-workflow/references/prior-art-build.md).
   On `prior_art_hit`, apply step 1’s stop and decision; an unresolved error also stops publication.
   Retain both ticket-search and base-check evidence in the qualification handoff and summary.
3. Frame the run with `@bakers-build/bb-run-intake`, then apply *Choose recipe and type* below.
4. Apply `@bakers-build/bb-acceptance` › *Gate each criterion before
   publishing it*. Name who tests under [result records](../bb-workflow/references/results.md) › *Test as*.
5. Apply *Propose an agent* below. Publish one complete `qualification` handoff through
   `@bakers-build/bb-publish-comment`, retaining searched terms, evidence and the fields below.
6. Present and publish `@bakers-build/bb-run-outtake` once. Obtain or
   reuse approval of the qualification handoff.
7. Publish authorized origin status via `@bakers-build/bb-publish-origin-status` and perform one final
   `@bakers-build/bb-transition-ticket` to `plan`.
   STOP without starting the destination step.

## Visible handoff

The typed qualification handoff records Outcome, Acceptance, Out of scope, then Handoff metadata.
Acceptance includes stable AC IDs and the quality gate's passed/rewritten tally, previous wording
for rewrites and explicit assumptions. Quality-gate approval is not a passed implementation test.
`@bakers-build/bb-run-outtake` alone owns the visible summary; retain complete criteria in this typed record.

Required fields:

- `acceptance_criteria`: exhaustive role-named, checkable conditions.
- `out_of_scope`: explicit boundary, including a reasoned none.
- `recipe` and `ticket_type`, with the reason for the recipe choice.
- `reproduction`: bug condition, otherwise `not_required`.
- `scenario_required`: whether confirmed runtime behavior needs a browser path.
- `test_as`: the personas who test and what each should see, or `no login needed`.
- `handoff_version`: monotonically increasing; requalification supersedes older versions.
- `provenance`: hash of title, description, type, recipe, labels and ticket revision.

## Choose recipe and type

Read the descriptions of the installed `bb-recipe-*` skills. Choose the recipe whose description fits
the ask; with no clear signal, the one declaring itself project default. Ask only on real
ambiguity; an unattended run takes the default. Then choose a type that recipe declares. Write both
on the ticket in one update with `--recipe_names <name>` (the suffix only: `matt` for
`bb-recipe-matt`) and `--type_names <type>`, which reuse or
create the terms, and read back the resolved `recipe` and `ticket_type`. Write no `work:*` or
`method:*` label and create no term by hand.

## Propose an agent

When evaluating agent routing during qualification, read [agent choice](references/agent-choice.md).
Preserve confirmed choices. Unattended runs recommend but write no agent label; failed catalog
lookup leaves existing defaults in force.
