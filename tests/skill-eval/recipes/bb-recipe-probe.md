---
name: bb-recipe-probe
description: Test recipe for tickets of type feature, bug or chore — never shipped; every slot leaves a marker in the run's output. Project default.
---

# Probe method

A test-only recipe for skill evaluations. Each slot names its marker; a run that applies the slot
shows the marker in its intake or outtake.

## bb-state-qualification

### bb-phase-work

Method `probe-qualify`: classify from the ask alone and ask nothing.

## bb-state-plan

### bb-phase-work

Method `probe-method`: ask exactly the questions in the ticket's `probe_questions`, each once, and
take the answers given beside them; write the spec from those answers only.

### bb-phase-outtake

Add the line `Probe-plan: <n>`, where `<n>` is the number of questions asked.

## bug:bb-state-plan

### bb-phase-work

Method `probe-bug-method`: diagnose from the reported failure and the supplied observations; ask
nothing.

## bb-state-working

### bb-phase-work

Method `probe-method`: build test-first.

### bb-phase-validate

Method `probe-validate`: also run every check the test plan marks `probe`.

### bb-phase-outtake

Add the line `Probe-working: <n>`, where `<n>` is the number of acceptance criteria in the handoff,
and the line `Probe-coverage: <value>` with the handoff's recorded line coverage.

## bug:bb-state-working

### bb-phase-work

Method `probe-bug-method`: start RED on the reproduced condition.

### bb-phase-outtake

Add the line `Probe-working-bug: <n>`, where `<n>` is the number of acceptance criteria in the
handoff.

## bb-state-review

### bb-phase-work

Method `probe-method`: review the diff against the criteria.
