# Freeze a ticket

**Pause one ticket so no agent picks it up, and release it whenever you like.**

**You need:** permission to update the ticket.

1. **Freeze it.** On the ticket page, choose **Freeze ticket** in the Properties footer and confirm. Or ask your agent:

   ```text
   Freeze <identifier> until I say otherwise.
   ```

2. **See the reason.** The ticket page and the tickets list show why a ticket stands still: *frozen*, *blocked*, *no conductor* or *failing*, for example `frozen 2 minutes ago`.

3. **Release it.** Choose **Unfreeze ticket**. The ticket keeps its state and becomes eligible again. A new run still needs an available conductor with access and capacity, a supported state, and no blockers or failure hold.

A freeze marks active runs *cancelled* with the note `frozen by <account>`. The conductor stops the agent when it observes cancellation. Check the run has stopped before changing files yourself. Freezing does not delete the worktree; project-specific freeze hooks may also run.

**Done when:** the ticket shows *frozen* and active runs are cancelled. After unfreezing, the frozen label disappears; [follow the ticket](/get-started/daily-work/follow-a-ticket) to check whether it starts or needs attention.

Conductor hooks and terminal freezing: [Tickets in the terminal](/addons/bakers-ui/tickets#freeze-a-ticket).
