---
name: bb-label-ticket-question
description: "Use when a ticket labelled `ticket-question` runs, in any state: reach a human only through the ticket, then freeze it."
---

# Ticket question

When the run needs a human, it reaches them only through the ticket: publish the comments below,
then add their label and set `frozen: true` in one `bakers_ticket_update`, and end the run. Every point where the frame waits for a human counts:
the approval of a qualification or of a spec, plan and test proposal, the coding-gate choice, the
confirmation of a review verdict and a `criterion` decision. Collect every open question of the run
into one user question.

A **user question** is one `comment` headed `# Question` with each question numbered, its context and
choices, the recommended choice marked per question, and last the line "Answer in a comment, then
remove the label *Question* and unfreeze the ticket."; label `Question`.

A **technical problem** is one comment headed `# Error` with the error and its output, or
`# Architecture` with the change and its reason, then this note as a second comment; label
`technical problem`.

```markdown
# Technical problem

Please contact the developers.
```

When the run resumes, an explicit answer in a ticket comment newer than the question is the human's
answer, for every question the frame asks, an approval or a gate choice included; silence or any
other comment is no answer.

The label `ticket-question` authorizes only these writes; transitions, origin status and the merge
follow the frame.
