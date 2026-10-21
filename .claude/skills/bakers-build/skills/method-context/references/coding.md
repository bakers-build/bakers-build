## Coding flow

Every coding owner follows this flow with its work-specific inputs and checks.

1. Read the ticket and all comments through `@bakers-build/read-ticket`; run
   `@bakers-build/ensure-qualification` and continue only on `qualified`. Resume the confirmed scope
   and verification plan. Resolve the method from the ticket's `method:*` label, falling back
   to the first available `Skill set` entry only when no label stands. Frame the GREEN target
   with `@bakers-build/run-intake`; publish `@bakers-build/acceptance` if absent for this scope.
2. Apply the pre-build base check; on `prior_art_hit` **STOP** before building. Report the
   candidate on `origin/<base_branch>` and ask whether to build anyway, fold into the existing
   ticket, or drop it. No build ran: publish no handoff and transition nothing. Otherwise use
   the existing isolated branch. The coding owner calls the original implementation
   method directly with the approved inputs and test seams. Use subagents where that method calls for them.
   Stop before its review activity. Before any environment-dependent execution, invoke
   `@bakers-build/resolve-environment` with the confirmed target and `review_actors`. Retain unresolved actors
   as blockers; resolve identities before running their checks.
3. Record plans/results using [result records](results.md). Run selected project and functional checks
   through `@bakers-build/verify-tests` and the confirmed
   browser helper where applicable. Fix within scope; record every applicable criterion as
   PASS or FAIL with command, result, and tested commit. Only all PASS reaches GREEN;
   missing or failed evidence stops the success gate.
4. Commit, push, and resolve the MR under the delivery contract. Supply the complete result, actor,
   access and deliverable records to the final owner; preserve every user and unresolved blocker.
5. Apply *Coding gate* below to publish the typed handoff and summary, including confirmed
   scope IDs, base/head SHAs, MR and per-criterion evidence. The last matching work type owns
   the single transition under `@bakers-build/workflow-step`; every work type must be GREEN.

## Coding gate

Every owner supplies its typed evidence. Only the last matching owner executes this gate after
collecting all sub-work results; earlier owners return without rendering, confirming or transitioning.
No ticket leaves `coding` without passing it. A step owner's
`coding` section **references this section and adds only its own tail** rather than restating it —
the same arrangement *Review flow* already uses, and this gate is that flow's step 6 at the other
end of the build.

1. Aggregate all sub-work records, render once through `@bakers-build/run-outtake`, and publish
   **both** the typed coding handoff and the `summary` comment first (`@bakers-build/workflow-step` › *Every
   transition leaves a handoff and a summary*). Both writes happen **before** the gate, so the work
   is durable whichever way the gate goes. **Both are owed here even when no transition follows**.
   Then print that summary in full in the terminal (`@bakers-build/run-outtake` › *Input contract*).

2. **Ask the human to confirm that summary and MR**, unless *Re-entry exception* applies. This
   question stops the run.
3. **After the confirmation, offer the next destination.** Never transition on the strength of the
   confirmation itself: confirming a summary says the work is *described* correctly, not where the
   ticket goes. The offer is keyed on the ticket's **workflow**, because that is what the state
   machine permits:
   - **`bb_feature`** — `review` alone. `finish` runs `from: [review]`, so `coding → done` is
     rejected; ask explicitly whether to move to `review`.
   - **`bb_bug`, `bb_chore`** — `review`, **or** `done` through the merge gate. `finish` runs
     `from: [review, coding]`. Recommend one first with its reason, then present both. `done`
     needs explicit merge authorization for this concrete delivery (*Authorization and state
     boundary*) and runs `@bakers-build/merge-mr` with the ticket's `identifier` field in this parent,
     including its *Caller handoff*,
     **before** `@bakers-build/transition-ticket`; a failed gate leaves the ticket in `coding` with the
     concrete next action and never reports `done`.

   `bb_bug` also permits `coding → diagnose` (`to_diagnose`). That is a recovery route
   for a missing or invalid diagnosis, not an outcome of a finished build, so it is not part of this
   offer — reach for it when the diagnosis itself is what failed.
4. **On no explicit choice, remain in `coding` and STOP.** Silence, a declined question, an
   ambiguous answer, and a non-interactive dispatch with no human at the other end are all "no
   choice". **An unattended run does not proceed through this gate.** It stops in `coding` with the
   handoff and summary published, which is a complete and resumable outcome rather than a failure.
   This is the one place where *Selecting the skill set*'s "An unattended run proceeds" deliberately
   does not apply, and the asymmetry is the point: a method choice is reversible, a transition
   dispatches the next run.
5. **A user restriction to `coding` skips the gate entirely** — the handoff and summary are
   published, nothing is asked, and nothing transitions. The restriction already is the human's
   answer.

### Re-entry exception

A **re-entry** is a `coding` pass the human sent back from `review`: their `Not OK` verdict already
chose the destination, so the pass publishes, transitions, and stops.

Apply the exception when all four hold:

1. the ticket's state is `coding`;
2. the ticket carries a comment of type `review`, and the **newest** one carries
   `Status: **Not OK**` (*Review flow* pins that line);
3. this pass reached GREEN across every applicable criterion;
4. the run carries no user restriction to `coding` — step 5 owns that case and keeps it.

Then run step 1 exactly as written, so the typed coding handoff and the `summary` are durable
first, and in place of steps 2–4 publish authorized origin status for `review`, then transition once through `@bakers-build/transition-ticket` and STOP.

Three consequences the conditions carry, none of them a rule of its own:

- **An unattended re-entry transitions** — the one case where step 4 gives way, licensed by
  condition 2: on a first pass the human has not seen the implementation, and on a re-entry they
  have.
- **The destination is `review`, and `review` alone**, whatever `finish` permits on `bb_bug` and
  `bb_chore`. `done` rests on explicit merge authorization for the concrete delivery
  (*Authorization and state boundary*), which a `Not OK` verdict does not supply.
- **A RED pass meets steps 1–5 as written** (condition 3), and so does one whose newest verdict
  reads `Status: **OK**` (condition 2) — which is how a ticket that passed review, merged and was
  later reopened reads.
