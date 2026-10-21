---
name: ensure-qualification
description: Guard a work state's entry by validating the latest qualification handoff; route the ticket back to qualification when it is missing, stale, incomplete, or contradictory.
---

# Ensure qualification

Guard the entry of a work state. Consume complete current-step context under `@gaia/read-ticket` (refresh on its triggers) and its **latest** qualification handoff (the
`qualification` comment with the highest `handoff_version`) and adjudicate it against the current
ticket. Return one of exactly two machine-clear outcomes: `qualified` or
`returned_to_qualification`. This guard is quiet when the handoff is valid: emit only the literal
`qualified`, with no findings, narrative, outtake, comment, or transition.

**When the handoff is valid** — present, current (its `provenance` matches the ticket's current
qualification-relevant inputs), complete (every required field present, optional fields explicitly
`not_required`), and internally consistent with the ticket — return `qualified` and change
**nothing**. The ticket state is left exactly as it is so the current state continues with its
phase skill.

**When the handoff is missing, stale, incomplete, or contradictory** — emit the structured findings
and do all of the following, then stop:

1. Publish **all** structured findings naming each defect (which field, why it fails).
2. Publish the honest summary; invoke authorized `@gaia/publish-origin-status` with `qualification`.
3. Invoke `@gaia/transition-ticket` with destination `qualification` as the final mutation.
4. Return `returned_to_qualification`.

Qualification fields and classification belong to `@gaia/qualify-ticket`. This guard owns only
recovery routing; step owners choose forward destinations. Return the literal `qualified` without
mutation when valid; on recovery return `returned_to_qualification` and stop.
