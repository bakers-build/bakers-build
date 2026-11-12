# Working

## references

always: read-ticket.md, tools.md, working.md, boundaries.md, prior-art-build.md, forge.md, evidence.md, results.md, delivery.md, ticket-writes.md, transition-ticket.md, outtake.md, outtake/working.md, coding-gate.md
if qualification entry guard fails: return-to-qualification.md
if acceptance is absent for confirmed scope: acceptance.md
if a check needs a running environment: verify.md, tools-conductor.md
if a browser path is selected: browser.md
if a preview is available: preview-links.md
if ticket has an origin: origin-status.md
if merge to done is explicitly authorized: merge.md, retrospective.md
if ticket read fails: read-ticket-troubleshooting.md
if paginated lookups are needed: tools-lookup.md
if forge tools absent: forge-fallback.md
if merging without tools: merge-fallback.md
if named retrospective causes: retrospective-evidence.md
if rating/reason supplied: retrospective-write.md
if rating supplied: measurement.md

## read

Use highest-handoff_version qualification. Recipe, type, entered state and handoff
acceptance_criteria present: emit `qualified`, continue unchanged. Otherwise execute
[return to qualification](return-to-qualification.md) and stop.
Resume confirmed scope/test plan; publish [acceptance](acceptance.md) if absent for this scope.

## provision

Apply frame Provision for runtime checks; [results](results.md) owns missing-persona handling.

## work

Apply [boundaries](boundaries.md), then [remote base check](prior-art-build.md).
On prior_art_hit report candidate and ask build anyway/fold/drop; stop before building,
publication or transition. Otherwise call recipe skills with approved inputs/seams on the
existing isolated branch, using subagents where prescribed; stop before method review.

## validate

Run matching WORKFLOW.md rows and confirmed functional checks, recording [results](results.md).
Use [verify](verify.md) for runtime execution and [browser](browser.md) for selected browser paths.
Fix within scope; every applicable AC needs PASS with command/observation/revision for GREEN.

## deliver

Commit/push/resolve MR under [delivery](delivery.md), preserving blockers in records.

## outtake

Issue required test_as logins via project hint. Via [ticket writes](ticket-writes.md) publish coding:
confirmed scope IDs, base/head, MR, per-AC evidence/logins. Render [outtake](outtake.md), publish
identical summary and print, also when blocked or restricted to working.

## transition

Apply [coding gate](coding-gate.md).
