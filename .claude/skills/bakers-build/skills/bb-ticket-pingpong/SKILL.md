---
name: bb-ticket-pingpong
description: "Use when a ticket labelled `ticket:pingpong` runs in working or review: it works on its own, decides technical questions itself, asks the user only content questions through the ticket and reports technical problems to keytec."
---

# Ticket pingpong

## Decide or ask

The user is the only person you ask, and only about content: what should change and what done
looks like. Settle every technical question yourself and record each decision with its reason under
`Decisions` in the state's typed handoff. A content question the ticket, repository and confirmed
scope cannot settle is a **user question**. A technical matter you cannot resolve is a
**technical problem**. Reach a person only through the ticket.

## Where the frame would ask

- `working` without a confirmed `spec`, `plan` or `test`: write the missing ones in this run
  through [plan](../bb-workflow/references/plan.md)'s `work` and `deliver` and the recipe's plan
  slot, each carrying `Approval: ticket:pingpong`; the label confirms an existing `spec`. Continue
  `working`.
- Remote base check, `prior_art_hit`: **technical problem**.
- [Coding gate](../bb-workflow/references/coding-gate.md), GREEN pass:
  [origin status](../bb-workflow/references/origin-status.md) for `review`, transition to `review`,
  STOP.
- Coding gate, RED pass that cannot reach GREEN within scope: **technical problem**.
- [Review](../bb-workflow/references/review.md) outtake, the verdict's confirmation: nothing to wait
  for.
- Review `OK`: keep the ticket in `review` and STOP; acceptance and merge happen outside this run.
- Review `Not OK`, no `criterion` cause: origin status for `working`, transition to `working`, STOP.
  When two earlier `review` comments carry `Status: **Not OK**`: **technical problem** instead.
- Review `Not OK` with a `criterion` cause: **user question**, the proposed rewrite as the
  recommended choice; no transition.
- Missing persona, access or environment; a failed check outside scope; a refused transition; the
  frame's stop rule: **technical problem**.
- Ensure qualification returns the ticket: as written.

The label authorizes each origin status above.

## User question

Use the [question channel](../bb-workflow/references/publish-comment.md#a-question-for-a-human):
one comment of type `comment` starting `# Question`, with context and numbered choices, the
recommended one marked. Then `bakers_ticket_update` with `labels_add: ["Question"]` and
`frozen: true`; check the readback and end the run.

## Technical problem

First the ticket shows what failed, with its command and output: publish the state's typed handoff
now unless one already says it. Then publish one comment of type `comment`, exactly:

```markdown
# Technical problem

Please contact keytec.
```

Then `bakers_ticket_update` with `labels_add: ["technical problem"]` and `frozen: true`; the
readback lists that label and `frozen: true`. It carries only its own label and is the run's last
write: print the comment id and end the run.
