# Freeze a ticket

**Pause one ticket so no agent picks it up, and release it whenever you like.**

**You need:** permission to update the ticket.

1. **Freeze it.** On the ticket page, choose **Freeze ticket** in the Properties footer and confirm. Or ask your agent:

   ```text
   Freeze <identifier> until I say otherwise.
   ```

2. **See the reason.** The ticket page and the tickets list show why a ticket stands still: *frozen*, *blocked*, *no conductor* or *failing*, for example `frozen 2 minutes ago`.

3. **Release it.** Choose **Unfreeze ticket**. The ticket keeps its state; the next poll starts a new run in it.

A freeze also ends the active run: it shows *cancelled* with the note `frozen by <account>`, and the conductor stops its agent on the next poll. The worktree and its uncommitted changes stay.

**Done when:** the ticket shows *frozen*, its run is cancelled and no new run starts; after you release it, the next run starts.

Conductor hooks and terminal freezing: [Tickets in the terminal](/addons/bakers-ui/tickets#freeze-a-ticket).
