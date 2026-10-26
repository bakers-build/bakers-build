---
name: bb-recipe-matt
description: Recipe for tickets of type feature, bug or chore — the Matt method, for hard, under-specified work. grilling to a shared understanding, then to-spec; diagnosing-bugs for bugs; implement with tdd; code-review. Project default.
---

# Matt method

Each section names the method's skills for one state; `@bakers-build/bb-workflow` supplies inputs,
publication, gates and transitions. Domain and runtime come from the project's hints and natively
matching skills, never from here. The skills are the originals from `mattpocock/skills`, as the
agent environment provides them.

## bb-state-qualification

### bb-phase-work

Ask only what the acceptance gate cannot decide; `grilling` builds the shared understanding at
plan.

## bb-state-plan

### bb-phase-work

Follow `grilling` until shared understanding, then `to-spec`.

## bug:bb-state-plan

### bb-phase-work

Follow `diagnosing-bugs` with the existing tests, the reported failure and the ticket.

## bb-state-working

### bb-phase-work

Follow `implement`; work test-first at the agreed seams with `tdd`.

### bb-phase-transition

Review is mandatory for a feature. A bug or chore may reach `done` from `working` through the
merge gate, only with explicit authorization.

## bug:bb-state-working

### bb-phase-work

Start from the confirmed diagnosis: RED on the reproduced condition with `tdd`, then GREEN.

## bb-state-review

### bb-phase-work

Review with `code-review`.
