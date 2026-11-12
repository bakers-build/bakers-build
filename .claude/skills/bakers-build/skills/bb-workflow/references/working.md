# Working

## references

Read in order at the consuming step; skip unmet conditions.

always: read-ticket.md, tools.md, working.md, entry-guard.md
if ticket read fails: read-ticket-troubleshooting.md
if needed comments missing: comment-context.md
if qualification entry guard fails: return-to-qualification.md
if acceptance is absent for confirmed scope: ticket-writes.md, acceptance.md
if a check needs a running environment: results.md, verify.md, tools-conductor.md
always: boundaries.md, prior-art-build.md, forge.md
if forge tools absent at an operation: forge-fallback.md
if paginated lookups are needed: tools-lookup.md
if a browser path is selected: browser.md
always: evidence.md, results.md, delivery.md, ticket-writes.md, transition-ticket.md
if a preview is available: preview-links.md
always: outtake.md, outtake/working.md, coding-gate.md
if asking for done/cancel confirmation: retrospective.md
if named retrospective causes: retrospective-evidence.md
if rating/reason supplied: retrospective-write.md
if measurements supplied: measurement.md
if merge to done is explicitly authorized: merge.md
if merging without tools: merge-fallback.md
if ticket has an origin: origin-status.md

## read

Make the working comment calls under [read ticket](read-ticket.md), then apply
[entry guard](entry-guard.md).
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
