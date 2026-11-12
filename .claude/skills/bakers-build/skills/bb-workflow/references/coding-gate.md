# Coding gate

At working transition, coding handoff and printed/published summary already exist.

1. Ask human to confirm summary and MR; stop for answer, except re-entry below.
2. After confirmation offer destination per recipe type slot. Summary acceptance confirms description,
   never routing. Mandatory review: ask review only. Optional: recommend review or done with reason,
   offer both. Done needs explicit concrete merge authorization ([boundaries](boundaries.md)),
   [merge](merge.md) using ticket's `identifier` field and Caller handoff **before** [transition](transition-ticket.md).
   Failed gate stays working, never done. Working→plan is recovery for wrong/missing plan/diagnosis,
   not a finished-build choice.
3. No explicit choice (silence, decline, ambiguity, unattended) stays working and STOP after handoff/
   summary. A transition dispatches the next run and waits for a human.
4. User restriction to working skips this gate: ask nothing, transition nothing.

## Re-entry exception

Replace 1–3 only when state is working, newest review comment contains `Status: **Not OK**`, all
applicable ACs reached GREEN, and no working-only restriction. Publish authorized
[origin status](origin-status.md) if present, transition once to review and STOP, even unattended:
the human's earlier verdict chose re-entry. Destination is review alone; done still needs merge
authorization. RED or newest OK verdict uses ordinary steps.
