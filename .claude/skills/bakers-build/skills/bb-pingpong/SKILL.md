---
name: bb-pingpong
description: "Use when a ticket labelled `ticket:pingpong` runs in working or review: carry it to done on your own, reaching the user only through the ticket."
---

# Pingpong

The label `ticket:pingpong` authorizes every transition with its origin status. Decide every
technical question yourself and record each decision with its reason under `Decisions` in the
state's handoff.

Reach the user only this way: publish the comments below, add the label, freeze the ticket and end
the run.

- **[User question](../bb-workflow/references/publish-comment.md#a-question-for-a-human):**
  content that the ticket, repository and confirmed scope cannot settle. Label `Question`. One
  comment of type `comment` headed `# Question`: the question, its context, numbered choices with
  the recommended one marked, and last the line "Answer in a comment, then remove the label
  *Question* and unfreeze the ticket."
- **Technical problem:** anything technical you cannot resolve. Label `technical problem`. One
  comment headed `# Error` with the error message and its output, then this note as another:

  ```markdown
  # Technical problem

  Please contact keytec.
  ```

In `working`, write a missing `spec`, `plan` or `test` in this run through
[plan](../bb-workflow/references/plan.md)'s `work` and `deliver` and the recipe's plan slot, each
carrying `Approval: ticket:pingpong`; the label confirms an existing `spec`. A GREEN pass of the
[coding gate](../bb-workflow/references/coding-gate.md) asks, in place of the gate's question, for
the user's one **acceptance**: a user question for a non-technical reader, carrying only what
changed, how to check it and one link, the tunnel link through
[preview links](../bb-workflow/references/preview-links.md) or, when nothing runs, the merge
request. Work requested changes and ask again; once accepted, every GREEN pass transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. On `OK`, merge
and transition to `done`: the label and the user's acceptance authorize the merge; with no
acceptance on the ticket, ask for it first. `Not OK` without a `criterion` cause, or a failed merge
gate, goes back to `working`. A `criterion` cause is a user question on the proposed rewrite.
