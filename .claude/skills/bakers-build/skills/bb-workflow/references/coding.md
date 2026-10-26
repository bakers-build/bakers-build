## Coding flow

Read in the `working` state. The recipe's `working` section supplies the method; this flow supplies
the bakers.build frame around it.

1. Resume the confirmed scope and verification plan from the ticket context. Frame the GREEN target
   with `@bakers-build/bb-run-intake`; publish `@bakers-build/bb-acceptance` if absent for this scope.
2. Apply the pre-build base check; on `prior_art_hit` **STOP** before building. Report the
   candidate on `origin/<base_branch>` and ask whether to build anyway, fold into the existing
   ticket, or drop it. No build ran: publish no handoff and transition nothing. Otherwise use
   the existing isolated branch. Call the recipe's implementation skills directly with the
   approved inputs and test seams. Use subagents where that method calls for them.
   Stop before its review activity. Before any environment-dependent execution, invoke
   `@bakers-build/bb-resolve-environment` with the confirmed target and the `test_as` personas. A **missing** persona
   blocks its checks; nobody else tests in its place.
3. Record plans/results using [result records](results.md). Run selected project and functional checks
   through `@bakers-build/bb-verify-tests` and the confirmed
   browser helper where applicable. Fix within scope; record every applicable criterion as
   PASS or FAIL with command, result, and tested commit. Only all PASS reaches GREEN;
   missing or failed evidence stops the success gate.
4. Commit, push, and resolve the MR under the delivery contract; preserve every user and
   unresolved blocker in the records.
5. Apply *Coding gate* below to publish the typed handoff and summary, including confirmed
   scope IDs, base/head SHAs, MR and per-criterion evidence, then the single transition.

## Coding gate

No ticket leaves `working` without passing it; a recipe never restates it. This gate is *Review
flow*'s step 6 at the other end of the build.

1. Render once through `@bakers-build/bb-run-outtake`, and publish
   **both** the typed coding handoff and the `summary` comment first (`@bakers-build/bb-workflow` › *transition*).
   Both writes happen **before** the gate, so the work
   is durable whichever way the gate goes. **Both are owed here even when no transition follows**.
   Then print that summary in full in the terminal (`@bakers-build/bb-run-outtake` › *Input contract*).

2. **Ask the human to confirm that summary and MR**, unless *Re-entry exception* applies. This
   question stops the run.
3. **After the confirmation, offer the next destination.** Never transition on the strength of the
   confirmation itself: confirming a summary says the work is *described* correctly, not where the
   ticket goes. The offer is keyed on the recipe's `review` section for the ticket's `ticket_type`:
   - **Review mandatory** (a feature under `bb-recipe-matt`) — `review` alone; ask explicitly whether
     to move to `review`.
   - **Review optional** — `review`, **or** `done` through the merge gate (`finish` leaves
     `working`). Recommend one first with its reason, then present both. `done`
     needs explicit merge authorization for this concrete delivery (*Authorization and state
     boundary*) and runs `@bakers-build/bb-merge-mr` with the ticket's `identifier` field in this parent,
     including its *Caller handoff*,
     **before** `@bakers-build/bb-transition-ticket`; a failed gate leaves the ticket in `working` with the
     concrete next action and never reports `done`.

   `to_plan` (`working → plan`) is a recovery route for a missing or wrong plan or diagnosis, not
   an outcome of a finished build, so it is not part of this offer.
4. **On no explicit choice, remain in `working` and STOP.** Silence, a declined question, an
   ambiguous answer, and a non-interactive dispatch with no human at the other end are all "no
   choice". **An unattended run does not proceed through this gate.** It stops in `working` with the
   handoff and summary published, which is a complete and resumable outcome rather than a failure.
   A recipe default applies unattended because it is reversible; a transition dispatches the
   next run, so it waits for a human.
5. **A user restriction to `working` skips the gate entirely** — the handoff and summary are
   published, nothing is asked, and nothing transitions. The restriction already is the human's
   answer.

### Re-entry exception

A **re-entry** is a `working` pass the human sent back from `review`: their `Not OK` verdict already
chose the destination, so the pass publishes, transitions, and stops.

Apply the exception when all four hold:

1. the ticket's state is `working`;
2. the ticket carries a comment of type `review`, and the **newest** one carries
   `Status: **Not OK**` (*Review flow* pins that line);
3. this pass reached GREEN across every applicable criterion;
4. the run carries no user restriction to `working` — step 5 owns that case and keeps it.

Then run step 1 exactly as written, so the typed coding handoff and the `summary` are durable
first, and in place of steps 2–4 publish authorized origin status for `review`, then transition once through `@bakers-build/bb-transition-ticket` and STOP.

Three consequences the conditions carry, none of them a rule of its own:

- **An unattended re-entry transitions** — the one case where step 4 gives way, licensed by
  condition 2: on a first pass the human has not seen the implementation, and on a re-entry they
  have.
- **The destination is `review`, and `review` alone**, whatever `finish` permits for the
  ticket's type. `done` rests on explicit merge authorization for the concrete delivery
  (*Authorization and state boundary*), which a `Not OK` verdict does not supply.
- **A RED pass meets steps 1–5 as written** (condition 3), and so does one whose newest verdict
  reads `Status: **OK**` (condition 2) — which is how a ticket that passed review, merged and was
  later reopened reads.
