---
name: bb-pingpong
description: "Use when a ticket labelled `ticket:pingpong` runs in working or review: carry it to done on your own."
---

# Pingpong

The label `ticket:pingpong` authorizes every transition with its origin status and, with the
user's acceptance, the merge. Decide technical questions yourself and record each with its reason
under `Decisions` in the handoff.

Reach the user only through the ticket: publish the comments, add the label, freeze the ticket and
end the run. A
**[user question](../bb-workflow/references/publish-comment.md#a-question-for-a-human)** asks what
should change or what done looks like, when the ticket, repository and confirmed scope leave it
open. It is one `comment` headed `# Question` with the question, its context, numbered choices with
the recommended one marked, and last the line "Answer in a comment, then remove the label
*Question* and unfreeze the ticket."; its label is `Question`. A **technical problem** is anything
technical you cannot resolve: one comment headed `# Error` with the error message and its output,
then this note as another; its label is `technical problem`.

```markdown
# Technical problem

Please contact keytec.
```

In `working`, write a missing `spec`, `plan` or `test` in this run through
[plan](../bb-workflow/references/plan.md)'s `work` and `deliver` and its recipe slot, with
`Approval: ticket:pingpong`; the label confirms an existing `spec`. In place of the
[coding gate](../bb-workflow/references/coding-gate.md)'s question, a GREEN pass asks for the
user's one **acceptance**: a user question for a non-technical reader with only what changed, how
to check it and one link, the tunnel link from
[preview links](../bb-workflow/references/preview-links.md) or, if nothing runs, the merge request.
Work requested changes and ask again; once accepted, GREEN transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. `OK` with the
acceptance on the ticket merges and transitions to `done`; without it, ask for the acceptance.
`Not OK`, or a failed merge gate, goes back to `working`; a `criterion` cause instead becomes a user
question that proposes the rewritten criterion.
