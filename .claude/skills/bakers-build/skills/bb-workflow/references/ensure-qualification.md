# Ensure qualification

Read at the `read` phase of `plan` and `working`: guard the entry of a work state. Consume complete
current-step context under [read ticket](read-ticket.md) (refresh on its triggers) and its
**latest** qualification handoff (the `qualification` comment with the highest `handoff_version`)
and adjudicate it against the current ticket. Return one of exactly two machine-clear outcomes:
`qualified` or `returned_to_qualification`. This guard is quiet when the handoff is valid: emit only
the literal `qualified`, with no findings, narrative, outtake, comment, or transition.

**When the handoff is valid** — the ticket has a `recipe`, a `type` and the state being entered,
and its latest `qualification` handoff carries `acceptance_criteria` — return `qualified` and
change **nothing**. The ticket state is left exactly as it is so the current state continues with
its next phase.

**When the recipe, type, state or acceptance criteria are missing**, including a missing handoff —
emit one structured finding per defect and do all of the following, then stop:

1. Publish **all** structured findings naming each defect (which field, why it fails).
2. Publish the honest summary; invoke authorized [origin status](origin-status.md) with `qualification`.
3. Invoke [transition ticket](transition-ticket.md) with destination `qualification` as the final
   mutation.
4. Return `returned_to_qualification`.

Qualification fields and classification belong to [qualification](qualification.md). This guard owns
only recovery routing; step owners choose forward destinations. Return the literal `qualified`
without mutation when valid; on recovery return `returned_to_qualification` and stop.
