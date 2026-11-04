---
name: bb-label-pingpong
description: "Use when a ticket labelled `pingpong` runs, in any state: carry it to done on your own."
---

# Pingpong

The label `pingpong` authorizes every transition, its origin status and the merge. Decide technical
questions yourself and record each decision with its reason under `Decisions` in the handoff.

Reach the user only through a user question or a technical problem in the ticket: publish its
comments, add its label, freeze the ticket and end the run. Collect every open question of the run
into one user question.

Until the user accepts the result, ask what should change or what done looks like as a
**[user question](../bb-workflow/references/publish-comment.md#a-question-for-a-human)**: one
`comment` headed `# Question` with each question numbered, its context and choices, the recommended
choice marked per question, and last the line "Answer in a comment, then remove the label *Question*
and unfreeze the ticket."; label `Question`. Once the user has accepted, decide those questions
yourself too, a `criterion` cause included.

A **technical problem** is anything technical you cannot resolve, and any change the plan does not
name to a dependency, the data model, a public interface, authentication, permissions, or build, CI
or deployment configuration: one comment headed `# Error` with the error and its output, or
`# Architecture` with the change and its reason, then this note as a second comment; label
`technical problem`.

```markdown
# Technical problem

Please contact the developers.
```

In `working`, at a GREEN [coding gate](../bb-workflow/references/coding-gate.md), ask instead for
the user's one **acceptance**: a user question for a non-technical reader with only what changed
and how to try it at exactly one URL, the tunnel link from
[preview links](../bb-workflow/references/preview-links.md) or, if nothing runs, the merge request.
Work requested changes and ask again; once accepted, GREEN transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. `OK` merges
only once the ticket holds the user's acceptance; otherwise ask for it. A failed merge gate goes
back to `working` if coding can fix it, and is a technical problem otherwise.
