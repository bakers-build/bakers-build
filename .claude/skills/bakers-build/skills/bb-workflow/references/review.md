# Review

## references

always: read-ticket.md, tools.md, review.md, boundaries.md, ../../bb-verdict/SKILL.md, results.md, evidence.md, ticket-writes.md, outtake.md, outtake/review.md, transition-ticket.md
if executing checks: verify.md
if runtime needed: tools-conductor.md
if browser selected: browser.md
if local surfaces supplied: preview-links.md
if measurements supplied: measurement.md
if origin exists: origin-status.md
if merge is authorized: merge.md, prior-art-build.md, forge.md, retrospective.md
if ticket read fails: read-ticket-troubleshooting.md
if paginated lookups are needed: tools-lookup.md
if forge tools absent: forge-fallback.md
if merging without tools: merge-fallback.md
if named retrospective causes: retrospective-evidence.md
if rating/reason supplied: retrospective-write.md

## read

Resume coding scope/MR/environment/evidence.

## provision

Frame Provision for runtime checks/logins only; fresh login links.

## work

Apply [boundaries](boundaries.md) and bb-verdict Reuse evidence; invoke `@bakers-build/bb-verdict`
in review subagent with recipe method; use verdict/findings.

### Review's closed repair list

Parent repairs only lint/format autofixes, docs wording or spec/acceptance alignment. No behavior,
test or schema/config repairs; rerun affected checks and publish evidence.

## validate

Chosen/repair checks: [verify](verify.md), [results](results.md).

## deliver

none

## outtake

Render/print [outtake](outtake.md); take human verdict confirmation (unattended: none to await).
Parent publishes full `review` verdict/evidence/walkthrough and `summary` via
[ticket writes](ticket-writes.md), plus supplied [measurement](measurement.md), before origin/state
writes, including blocked/restricted runs.
Review line: `Status: **OK**` or `Status: **Not OK**`.

## transition

OK: authorized [merge](merge.md) once, ticket `identifier` field/Caller handoff; verified merge permits
done, failed gate holds review with next action.
Not OK without criterion cause: working once for named finding outside closed repairs, no merge.
Any criterion cause, also mixed: hold review, show causes/rewrite for operator decision, never
auto-route qualification.
Unattended: stop after publication.
Authorized: [origin status](origin-status.md) if present, final [state write](transition-ticket.md),
STOP. Holds change nothing.
