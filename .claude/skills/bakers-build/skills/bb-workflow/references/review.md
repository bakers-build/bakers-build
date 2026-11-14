# Review

## references

Step order; skip unmet conditions.

always: read-ticket.md, tools.md, review.md
if read fails: read-ticket-troubleshooting.md
if needed comments missing: comment-context.md
always: boundaries.md, ../../bb-verdict/SKILL.md
if executing checks: verify.md
if browser selected: browser.md
always: results.md, evidence.md
if local surfaces: preview-links.md
always: ticket-writes.md, outtake.md, outtake/review.md
if measurements: measurement.md
if asking done/cancel confirmation: retrospective.md
if causes named: retrospective-evidence.md
if rating/reason supplied: retrospective-write.md
if merge is authorized: merge.md, prior-art-build.md, forge.md
if forge tools absent: forge-fallback.md
if merging without tools: merge-fallback.md
if origin exists: origin-status.md
always: transition-ticket.md

## read

Resume coding scope/MR/evidence/environment.

## provision

Frame Provision for runtime checks/logins; fresh login links.

## work

Apply [boundaries](boundaries.md); invoke `@bakers-build/bb-verdict` in a review subagent with the
recipe method and its Reuse evidence rules. Use its verdict/findings.

### Review's closed repair list

Parent repairs only lint/format autofixes, docs wording or spec/acceptance alignment; no behavior,
test or schema/config repairs. Rerun affected checks and publish evidence.

## validate

Checks: [verify](verify.md), [results](results.md).

## deliver

none

## outtake

Render/print [outtake](outtake.md); obtain human verdict confirmation unless unattended.
Via [ticket writes](ticket-writes.md), publish full `review` verdict/evidence/walkthrough, `summary`
and supplied [measurement](measurement.md) before origin/state writes, even when blocked/restricted.
Verdict: `Status: **OK**` or `Status: **Not OK**`.

## transition

OK: pass the ticket's `identifier` to the authorized [merge](merge.md) once and apply its Caller
handoff. Verified merge permits done; a failed gate holds review with next action.
Not OK without criterion cause: return to working once for a finding outside closed repairs.
Any criterion cause, including mixed: hold review; show causes/rewrite for operator decision.
Never auto-route qualification.
Unattended: publish and stop.
Authorized: [origin status](origin-status.md) if present, final [state write](transition-ticket.md),
STOP. Holds write nothing.
