---
name: bb-create-ticket
description: Use when creating a bakers.build ticket from an intake or resuming an interrupted ticket creation.
---

# Create a ticket

Read supplied `$BB_NEW_TICKET_INPUT` first. For an existing or resumed ticket (`is_new: false`),
resolve its UUID and use [read ticket](../bb-workflow/references/read-ticket.md); do not create a replacement. Collect title, project,
workflow, Markdown description, scope and optional assignment/relationships from the intake.

## Prior art — search before the live create

Execute [prior-art search](../bb-workflow/references/prior-art-search.md) completely — every
spelling in both fields — before judging it. On a hit, stop before writing; report identifier, title, state, assignee and available MR/merge, then obtain the decision.
Retain searched terms and evidence. An error is not a negative.

## Propose the branch's ticket as `parent_id`

An explicit intake parent wins. Otherwise resolve the ticket whose `branch_name` matches this
checkout and propose that parent; a rejection means no parent. No matching ticket means no proposal.
`base_branch` is computed from the parent; never write it. Preserve explicit null conductor choices.

## The write

Apply [ticket writes](../bb-workflow/references/ticket-writes.md): body file → field parameters → live.
Use the supplied title verbatim. Inspect `--fields`, then supply actual variables in the same call:

```bash
bakers dropsh create bb_ticket --bundle bb_ticket --fields
bakers dropsh create bb_ticket --bundle bb_ticket   --title="$TITLE" --workflow "$WORKFLOW"   --description.value="$(cat "$DESC_FILE")" --description.format bb_rich   --project_id "$PROJECT_UUID" --recipe_names "$RECIPE" --type_names "$TYPE"
```

Choose `RECIPE` and `TYPE` under [classify](../bb-workflow/references/classify.md); a deployment
takes `deploy-and-release` and `deployment`, a verification `verify` and `verification`. Retain the returned UUID immediately as `TICKET_UUID`;
read it back through [read ticket](../bb-workflow/references/read-ticket.md) and verify project, title, description, recipe, type and initial state.
On uncertain creation reconcile the known UUID or uniquely matching context before retrying;
ambiguous results remain unresolved. Preserve schema validation and exact field names.

## Qualify and route in the same action

Creation intake is the qualification confirmation; avoid a second human qualify pass.
Apply [agent choice](../bb-workflow/references/agent-choice.md).
Publish exactly `qualification` through [publish comment](../bb-workflow/references/publish-comment.md), using every required field from
[qualification](../bb-workflow/references/qualification.md) › *outtake*, including `test_as`, `out_of_scope`, `handoff_version`, provenance,
reproduction, `scenario_required`, recipe choice and prior-art evidence. Follow
[result records](../bb-workflow/references/results.md) for missing user/environment questions.
Use explicit `not_required`/`false` where applicable.

Publish one [outtake](../bb-workflow/references/outtake.md) `summary` the same way. Each returns a confirmed UUID or a concrete failure.
**Route only after both UUIDs are confirmed.** Otherwise leave the ticket in `qualification`,
report the failure and STOP.

Then publish authorized origin status and transition once through [transition ticket](../bb-workflow/references/transition-ticket.md)
to `plan`. Verify readback and STOP.
Create no phase artifacts or implementation unless the shortcut below applies.

## A fully specified intake goes straight to `working`

Only confirmed design, implementation plan and test plan permit this shortcut; bugs additionally
require reproduction and diagnosis. Publish complete confirmed `spec`, `plan`, `test` comments,
then use `working` as the single destination. Otherwise retain normal routing.

For a scope-free measurement baseline, read [baseline creation](references/baseline.md).
`create_ticket` is an on-demand action, not a workflow state. Return identifier, link and destination.
