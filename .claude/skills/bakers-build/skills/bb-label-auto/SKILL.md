---
name: bb-label-auto
description: "Use when a ticket labelled `auto` runs, in any state: carry it to done on your own."
---

# Auto

The label `auto` passes every [gate](../bb-workflow/references/gates.md) on its own, recipe gates
included, except the user question and acceptance below, and authorizes every transition, its origin
status and the merge. Record each passed gate under `### Gates` in the handoff. Decide technical
questions yourself and record each decision with its reason under `Decisions` in the handoff.

Ask the user only what is theirs to decide: a choice the confirmed acceptance criteria leave open,
such as what the result looks like or how it behaves. Collect those into one **user question** per
run; decide everything else yourself, a `criterion` cause included.

A **technical problem** is anything technical you cannot resolve, and any unplanned risky change
([gates](../bb-workflow/references/gates.md) › *Risk list*). Report it to the developers with the
error and its output, or the change and its reason, and end the run; it is never a user question.

The user accepts the result once, and only when something was theirs to decide. Then, in `working`
at a GREEN [coding gate](../bb-workflow/references/coding-gate.md), ask for that one **acceptance**:
a user question for a non-technical reader with only what changed and how to try it at exactly one
URL, the tunnel link from [preview links](../bb-workflow/references/preview-links.md) or, if nothing
runs, the merge request. Work requested changes and ask again. When the criteria decided everything,
record "no acceptance due" with its reason under `Decisions`, and GREEN transitions to `review`.

In [review](../bb-workflow/references/review.md), the verdict needs no confirmation. `OK` merges
once the handoff holds the user's acceptance or "no acceptance due"; otherwise ask for it. A failed
merge gate goes back to `working` if coding can fix it, and is a technical problem otherwise.
