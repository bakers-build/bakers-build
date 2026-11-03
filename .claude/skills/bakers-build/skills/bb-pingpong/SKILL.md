---
name: bb-pingpong
description: "Use when a ticket labelled `pingpong` runs in working or review: carry it to done on your own."
---

# Pingpong

The label `pingpong` authorizes every transition, its origin status and the merge. Decide
technical questions yourself, and after the user's acceptance content questions too, a `criterion`
cause by its proposed rewrite; record each decision with its reason under `Decisions` in the
handoff.

Reach the user only through the ticket: publish the comments, add the label, freeze the ticket and
end the run. Before the acceptance, a
**[user question](../bb-workflow/references/publish-comment.md#a-question-for-a-human)** asks what
should change or what done looks like: one `comment` headed `# Question` with the question, its
context and numbered choices, the recommended one marked, and last the line "Answer in a comment,
then remove the label *Question* and unfreeze the ticket."; label `Question`. A **technical
problem** is anything technical you cannot resolve, or a new dependency or change to the data
model, a public interface, authentication, permissions, or build, CI or deployment configuration
that the confirmed plan does not name: one comment headed `# Error` with the error message and its
output, or `# Architecture` with the change and its reason, then this note as another; label
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

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation, and a failed
merge gate that coding can fix goes back to `working`. `OK` merges only once the ticket holds the
user's acceptance; otherwise ask for it.
