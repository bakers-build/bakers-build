---
name: create-ticket
description: Use when creating a GAIA ticket from an intake or resuming an interrupted ticket creation.
---

# Create a ticket

Read supplied `$GAIA_NEW_TICKET_INPUT` first. For an existing or resumed ticket (`is_new: false`),
resolve its UUID and use `@gaia/read-ticket`; do not create a replacement. Collect title, project,
workflow, Markdown description, scope and optional assignment/relationships from the intake.

## Prior art — search before the live create

Execute [prior-art search](../workflow-step/references/prior-art-search.md). On a hit, stop before
writing; report identifier, title, state, assignee and available MR/merge, then obtain the decision.
Retain searched terms and evidence. An error is not a negative.

## Propose the branch's ticket as `parent_id`

An explicit intake parent wins. Otherwise resolve the ticket whose `branch_name` matches this
checkout and propose that parent; a rejection means no parent. No matching ticket means no proposal.
`base_branch` is computed from the parent; never write it. Preserve explicit null conductor choices.

## The write

Apply `@gaia/workflow-step` Markdown and validated-write rules: body file → field parameters → live.
Use the supplied title verbatim. Inspect `--fields`, then supply actual variables in the same call:

```bash
gaia dropsh create gaia_ticket --bundle gaia_ticket --fields
gaia dropsh create gaia_ticket --bundle gaia_ticket   --title="$TITLE" --workflow "$WORKFLOW"   --description.value="$(cat "$DESC_FILE")" --description.format gaia_rich   --project_id "$PROJECT_UUID" --label_names "$WORK_LABELS"
```

Use comma-separated applicable work labels. Retain the returned UUID immediately as `TICKET_UUID`;
read it back through `@gaia/read-ticket` and verify project, title, description and initial state.
On uncertain creation reconcile the known UUID or uniquely matching context before retrying;
ambiguous results remain unresolved. Preserve schema validation and exact field names.

## Qualify and route in the same action

Creation intake is the qualification confirmation; avoid a second human qualify pass.
Choose the method through method-context and apply qualify-ticket's *Propose an agent*.
Publish exactly `qualification` through `@gaia/publish-comment`, using every required field from
`@gaia/qualify-ticket`, including `review_actors`, `out_of_scope`, `handoff_version`, provenance,
reproduction, `scenario_required`, method choice and prior-art evidence. Follow
[result records](../method-context/references/results.md) for missing user/environment questions.
Use explicit `not_required`/`false` where applicable.

Publish one outtake `summary` the same way. Each returns a confirmed UUID or a concrete failure.
**Route only after both UUIDs are confirmed.** Otherwise leave the ticket in `qualification`,
report the failure and STOP.

Then publish authorized origin status and transition once through `@gaia/transition-ticket`:
feature/chore → `spec`, bug → `diagnose`. Verify readback and STOP.
Create no phase artifacts or implementation unless the shortcut below applies.

## A fully specified intake goes straight to `coding`

Only confirmed design, implementation plan and test plan permit this shortcut; bugs additionally
require reproduction and diagnosis. Publish complete confirmed `spec`, `plan`, `test` comments,
then use `coding` as the single destination. Otherwise retain normal routing.

For a scope-free measurement baseline, read [baseline creation](references/baseline.md).
`create_ticket` is an on-demand action, not a workflow state. Return identifier, link and destination.
