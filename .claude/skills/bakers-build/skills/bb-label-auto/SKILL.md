---
name: bb-label-auto
description: "Use when a ticket labelled `auto` runs, in any state: carry it to done on your own."
---

# Auto

The label `auto` authorizes every transition, its origin status and the merge. Decide technical
questions yourself and record each decision with its reason under `Decisions` in the handoff.

Collect every open question of the run into one **user question**. Until the user accepts the
result, ask what should change or what done looks like. Once the user has accepted, decide those
questions yourself too, a `criterion` cause included.

A **technical problem** is anything technical you cannot resolve, and any change the plan does not
name to a dependency, the data model, a public interface, authentication, permissions, or build, CI
or deployment configuration. Report it to the developers with the error and its output, or the
change and its reason, and end the run; it is never a user question.

In `working`, at a GREEN [coding gate](../bb-workflow/references/coding-gate.md), ask instead for
the user's one **acceptance**: a user question for a non-technical reader with only what changed
and how to try it at exactly one URL, the tunnel link from
[preview links](../bb-workflow/references/preview-links.md) or, if nothing runs, the merge request.
Work requested changes and ask again; once accepted, GREEN transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. `OK` merges
only once the ticket holds the user's acceptance; otherwise ask for it. A failed merge gate goes
back to `working` if coding can fix it, and is a technical problem otherwise.
