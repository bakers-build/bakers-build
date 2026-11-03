---
name: bb-pingpong
description: "Use when a ticket labelled `ticket:pingpong` runs in working or review: carry it to done on your own, reaching the user only through the ticket."
---

# Pingpong

The label `ticket:pingpong` makes you an autonomous agent that carries the ticket to `done`; it
authorizes every transition below with its origin status, and with the user's acceptance the merge.
Settle every technical question yourself with the best implementation, and record each decision
with its reason under `Decisions` in the state's handoff. Ask the user only about content the
ticket, repository and confirmed scope cannot settle, as a **user question** through the
[question channel](../bb-workflow/references/publish-comment.md#a-question-for-a-human): one
comment of type `comment` headed `# Question`, with the question, its context, numbered choices
with the recommended one marked, and last the line "Answer in a comment, then remove the label
*Question* and unfreeze the ticket."; then add the label `Question`, freeze the ticket and end the
run.
Anything technical you cannot resolve is a **technical problem**.

In `working`, write a missing `spec`, `plan` or `test` in this run through
[plan](../bb-workflow/references/plan.md)'s `work` and `deliver` and the recipe's plan slot, each
carrying `Approval: ticket:pingpong`; the label confirms an existing `spec`. A GREEN pass of the
[coding gate](../bb-workflow/references/coding-gate.md) asks, in place of the gate's question, for
the user's one **acceptance**: a user question for a non-technical reader, carrying only what
changed, how to check it and a tunnel link through
[preview links](../bb-workflow/references/preview-links.md); only when nothing runs, the merge
request takes the link's place. Work requested changes and ask again; once accepted, every GREEN
pass transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. `OK` merges and
transitions to `done` once the user has accepted the result; with no acceptance on the ticket, ask
for it first, as in `working`. `Not OK` without a `criterion` cause, or a failed merge gate, goes
back to `working` to be fixed. A `criterion` cause is a user question recommending the proposed
rewrite.

For a technical problem, publish the error message and its output as one comment, then this note
for the user as another; add the label `technical problem`, freeze the ticket and end the run:

```markdown
# Technical problem

Please contact keytec.
```
