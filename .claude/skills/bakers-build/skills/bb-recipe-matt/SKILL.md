---
name: bb-recipe-matt
description: Recipe for tickets of type feature, bug or chore — the Matt method, for hard, under-specified work. grilling to a shared understanding, then to-spec; diagnosing-bugs for bugs; implement with tdd; code-review. Project default.
---

# Matt method

One section per work state names the method's skills; `@bakers-build/bb-workflow` supplies inputs,
publication, gates and transitions. A type subsection governs tickets of that `ticket_type`. Domain and runtime come from the project's hints and natively
matching skills, never from here. The skills are the originals from `mattpocock/skills`, as the
agent environment provides them.

## plan

Follow `grilling` until shared understanding, then `to-spec`.

### bug

Follow `diagnosing-bugs` with the existing tests, the reported failure and the ticket.

## working

Follow `implement`; work test-first at the agreed seams with `tdd`.

### bug

Start from the confirmed diagnosis: RED on the reproduced condition, then GREEN.

## review

Review with `code-review`. Review is mandatory for a feature; a bug or chore may reach `done` from
`working` through the Coding gate's merge gate, only with explicit authorization.
