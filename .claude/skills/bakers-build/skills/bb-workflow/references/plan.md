# Plan

Plan the confirmed ask. The recipe's slots supply the method; this flow supplies the frame around
it. The method produces no implementation.

## read

Make the *plan* comment call of [read ticket](read-ticket.md), then apply
[ensure qualification](ensure-qualification.md); continue only on `qualified`.

## provision

A bug whose reproduction needs a runtime applies the frame's *Provision* rule, so its RED observation runs on the worktree's site; otherwise none.

## work

Apply [boundaries](boundaries.md). Give the method the ticket's acceptance criteria, repository
boundaries and the project's hints, with this ticket as the tracker target. A selected browser path
is prepared under [browser](browser.md) › *Paths*.

## validate

none — a bug records a real RED observation of the reported condition before any fix, under
[result records](results.md).

## deliver

Publish the method's result through [publish comment](publish-comment.md) as complete comments:
`spec`, `plan` and `test`. A bug publishes the cause and observed evidence as `debug_diagnose`
instead of `spec`.

The `test` comment separates applicable project checks from the functional regression and records
per check its type, rationale, command/path, expected RED and GREEN, and the evidence it will
report. Use the approved seams and reuse suitable coverage.

## outtake

Render through [the outtake](outtake.md), publish it as its own comment of type `summary`, and print it.

## transition

Obtain **one** approval covering the proposal (for a bug: cause, fix direction and verification
plan); reuse approval already given for this scope. Without it, STOP in `plan`. With it, record the
confirmed comment IDs, publish authorized [origin status](origin-status.md) for `working` and
[transition](transition-ticket.md) once to `working`, with its readback. STOP.
