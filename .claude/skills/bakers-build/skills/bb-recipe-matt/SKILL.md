---
name: bb-recipe-matt
description: Recipe for tickets of type feature, bug or chore — the Matt method; grilling to a shared understanding, then a spec; diagnosing-bugs for bugs; tdd; code-review.
metadata:
  requires: "mattpocock-skills:grilling mattpocock-skills:tdd mattpocock-skills:code-review"
  requires-bug: "mattpocock-skills:diagnosing-bugs mattpocock-skills:tdd mattpocock-skills:code-review"
---

# Matt method

Each section names the method's skills for one state; `@bakers-build/bb-workflow` supplies inputs,
publication, gates and transitions. Domain and runtime come from the project's hints and natively
matching skills, never from here. The skills are the originals from `mattpocock/skills`, as the
agent environment provides them; the slots name only skills the agent can invoke, and carry the
user-only ones' method inline.

## bb-state-qualification

### bb-phase-work

Ask only what the acceptance gate cannot decide; `grilling` builds the shared understanding at
plan.

## bb-state-plan

### bb-phase-work

Follow `grilling` until shared understanding, then write the spec from it, with no further
interview, in these sections: Problem Statement, Solution, User Stories, Implementation Decisions,
Testing Decisions, Out of Scope, Further Notes.

## bug:bb-state-plan

### bb-phase-work

Follow `diagnosing-bugs` with the existing tests, the reported failure and the ticket.

## bb-state-working

### bb-phase-work

Work test-first at the agreed seams with `tdd`.

### bb-phase-transition

Review is mandatory for a feature. A bug or chore may reach `done` from `working` through the
merge gate, only with explicit authorization.

## bug:bb-state-working

### bb-phase-work

Start from the confirmed diagnosis: RED on the reproduced condition with `tdd`, then GREEN.

## bb-state-review

### bb-phase-work

Review with `code-review`.
