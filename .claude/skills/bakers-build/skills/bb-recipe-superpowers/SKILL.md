---
name: bb-recipe-superpowers
description: Recipe for tickets of type feature, bug or chore — the superpowers method; brainstorming to an approved design, writing-plans, executing-plans with test-driven-development, systematic-debugging for bugs, requesting-code-review.
metadata:
  requires: "superpowers:brainstorming superpowers:writing-plans superpowers:executing-plans superpowers:subagent-driven-development superpowers:test-driven-development superpowers:requesting-code-review superpowers:verification-before-completion"
  requires-bug: "superpowers:systematic-debugging superpowers:executing-plans superpowers:subagent-driven-development superpowers:test-driven-development superpowers:requesting-code-review superpowers:verification-before-completion"
---

# Superpowers method

Each section names the method's skills for one state; `@bakers-build/bb-workflow` supplies inputs,
publication, gates and transitions. Domain and runtime come from the project's hints and natively
matching skills, never from here. The skills are the originals from `obra/superpowers`, as the
agent environment provides them.

## bb-state-qualification

### bb-phase-work

Ask only what the acceptance gate cannot decide; `brainstorming` builds the shared understanding at
plan.

## bb-state-plan

### bb-phase-work

Follow `brainstorming` to an approved design, then `writing-plans`; the plan is the spec.

## bug:bb-state-plan

### bb-phase-work

Follow `systematic-debugging` with the existing tests, the reported failure and the ticket.

## bb-state-working

### bb-phase-work

Follow `executing-plans` task by task, or `subagent-driven-development` when the run may dispatch
subagents; work test-first at the agreed seams with `test-driven-development`.

### bb-phase-transition

Review is mandatory for a feature. A bug or chore may reach `done` from `working` through the
merge gate, only with explicit authorization.

## bug:bb-state-working

### bb-phase-work

Start from the confirmed diagnosis: RED on the reproduced condition with `test-driven-development`,
then GREEN.

## bb-state-review

### bb-phase-work

Review with `requesting-code-review`; claim nothing `verification-before-completion` has not shown.
