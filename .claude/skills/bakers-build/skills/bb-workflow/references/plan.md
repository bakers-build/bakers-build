# Plan

## references

always: read-ticket.md, tools.md, plan.md, boundaries.md, evidence.md, ticket-writes.md, outtake.md, outtake/plan.md, transition-ticket.md
if entry guard fails: return-to-qualification.md
if ticket is a bug: results.md
if a browser path is selected: browser.md
if reproduction needs runtime: verify.md, tools-conductor.md
if ticket has an origin: origin-status.md
if ticket read fails: read-ticket-troubleshooting.md
if paginated lookups are needed: tools-lookup.md

## read

Use highest-handoff_version qualification. With recipe, type, entered state and handoff
acceptance_criteria, emit only `qualified`, continue unchanged; otherwise execute
[return to qualification](return-to-qualification.md) and stop.

## provision

Runtime-dependent bug reproduction uses the frame's Provision rule; otherwise none.

## work

Apply [boundaries](boundaries.md); run recipe method with acceptance criteria. Prepare selected [browser paths](browser.md) only when needed.

## validate

For bugs record real pre-fix RED under [results](results.md); otherwise none.

## deliver

Publish complete `spec`, `plan`, `test` via [ticket writes](ticket-writes.md). Bugs publish cause
and observations as `debug_diagnose` instead of spec. Test plan uses approved seams/reused coverage, separating Project checks/Functional validation.
Per check: type, rationale, command/path, expected RED/GREEN, evidence to report.

## outtake

Render [outtake](outtake.md), publish `summary`, print it.

## transition

Obtain one approval of proposal (bugs: cause, fix direction, verification); reuse covering
approval. Without approval stop in plan. Otherwise record confirmed comment IDs, publish
authorized [origin status](origin-status.md) if origin exists, [transition](transition-ticket.md)
once to working, verify readback and STOP.
