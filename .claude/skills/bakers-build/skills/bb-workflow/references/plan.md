# Plan

## references

Read in order at the consuming step; skip unmet conditions.

always: read-ticket.md, tools.md, plan.md, entry-guard.md
if ticket read fails: read-ticket-troubleshooting.md
if qualification entry guard fails: return-to-qualification.md
if reproduction needs runtime: results.md, verify.md, tools-conductor.md
always: boundaries.md
if a browser path is selected: browser.md
if recording checks: results.md
always: evidence.md, ticket-writes.md, outtake.md, outtake/plan.md, transition-ticket.md
if paginated lookups are needed: tools-lookup.md
if ticket has an origin: origin-status.md

## read

Apply [entry guard](entry-guard.md).

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
