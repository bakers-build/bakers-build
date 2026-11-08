# Coding gate

Read at working's `transition`. No ticket leaves `working` without passing it; a recipe never
restates it. Working's `outtake` has already published the typed coding handoff and the `summary`
and printed it, so the work is durable whichever way the gate goes.

1. **Ask the human to confirm that summary and MR**, unless *Re-entry exception* applies. This
   question stops the run.
2. **After the confirmation, offer the next destination.** Confirming a summary says the work is
   *described* correctly, not where the ticket goes, so it never transitions by itself. The offer
   follows the recipe's working `bb-phase-transition` slot for the ticket's type:
   - **Review mandatory** — `review` alone; ask explicitly whether to move to `review`.
   - **Review optional** — `review`, **or** `done` through the merge gate. Recommend one first with
     its reason, then present both. `done` needs explicit merge authorization for this concrete
     delivery ([boundaries](boundaries.md) › *Authorization and state boundary*) and runs
     [merge](merge.md) with the ticket's `identifier` field in this parent, including its *Caller
     handoff*, **before** the [transition](transition-ticket.md); a failed gate leaves the ticket in
     `working` with the concrete next action and never reports `done`.

   `working → plan` is a recovery route for a missing or wrong plan or diagnosis, not an outcome
   of a finished build, so it is not part of this offer.
3. **On no explicit choice, remain in `working` and STOP.** Silence, a declined question, an
   ambiguous answer, and a non-interactive dispatch with no human at the other end are all "no
   choice". **An unattended run does not proceed through this gate**: it stops in `working` with
   handoff and summary published, a complete and resumable outcome. A transition dispatches the
   next run, so it waits for a human. An explicit answer to the gate's question
   in a ticket comment newer than the question is a choice.
4. **A user restriction to `working` skips the gate entirely** — nothing is asked and nothing
   transitions. The restriction already is the human's answer.

## Re-entry exception

A **re-entry** is a `working` pass the human sent back from `review`: their `Not OK` verdict already
chose the destination. Apply the exception when all four hold:

1. the ticket's state is `working`;
2. the **newest** comment of type `review` carries `Status: **Not OK**` ([review](review.md) pins
   that line);
3. this pass reached GREEN across every applicable criterion;
4. the run carries no user restriction to `working` — step 4 owns that case.

Then, in place of steps 1–3, publish authorized [origin status](origin-status.md) for `review`,
transition once to `review` and STOP. Consequences:

- **An unattended re-entry transitions** — the one case where step 3 gives way: on a first pass
  the human has not seen the implementation, on a re-entry they have.
- **The destination is `review` alone**, whatever the slot permits: `done` rests on explicit merge
  authorization, which a `Not OK` verdict does not supply.
- **A RED pass, or one whose newest verdict reads `Status: **OK**`** (a ticket reopened after
  merge), meets steps 1–4 as written.
