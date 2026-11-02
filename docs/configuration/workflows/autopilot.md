# Autopilot workflow

**`bb_autopilot` runs a ticket from qualification to review without asking you for approvals; the merge stays yours.**

`bb_autopilot` ("bakers.build autopilot") has the same [states and transitions](/configuration/workflows/states#bb-work) as `bb_work`. The difference is who confirms each step: the workflow does, so a ticket goes from qualification to review without waiting for you.

| State | What is automatic | What stays with you |
|---|---|---|
| `qualification` | approving the handoff; the ticket moves to `plan` | a prior-art hit |
| `plan` | approving spec, plan and test (or the diagnosis); the ticket moves to `working` | |
| `working` | confirming the summary and merge request; the ticket moves to `review` | a failed or blocked check |
| `review` | confirming the verdict; `Not OK` returns the ticket to `working` | merge authorization after `OK`, and a `criterion` finding |

Each handoff records `Approval: automatic (workflow bb_autopilot)`. In every state:

- **The merge is yours.** After `OK` the ticket waits in `review` until you authorize the merge. An autopilot ticket is never merged or finished without you.
- **Real questions still reach you.** An agent asks a question the ticket cannot answer in its run's terminal pane, and the run waits for your answer.
- **Failures stop the ticket.** A failed or blocked check, an unmet coding gate, a prior-art hit or a refused transition stops the ticket in its state, with the failure published.
- **Repair loops are bounded.** After two `Not OK` verdicts, the next coding gate asks you to confirm again.

Each state declares its approval in `bb_core.workflows.yml` (`approval: automatic`; `human` when absent), and `bakers_ticket_read` returns it for the ticket's current state.

## Choosing the workflow

- **On create:** pick *bakers.build autopilot* in the create dialog's Workflow picker, choose *autopilot* in the `bakers ui` create form, or pass `workflow: bb_autopilot` to `bakers_ticket_create`. Without a choice, a ticket gets `bb_work`.
- **On edit:** change *Workflow* in the ticket's Settings, or in the `bakers ui` edit popup. The ticket keeps its state, because both workflows have the same states. A closed ticket cannot be switched, and switching needs the same access as editing the ticket.
