Every fetch, push, MR write, check read and merge runs through [forge operations](forge.md). For
a GitHub repository, [GitHub delivery](github-delivery.md) adds its specifics; preserve all shared
gates and handoff requirements.

## Coding and review handoff

Commit the scoped change, then push it and create or update its MR through the forge operations.
Follow project commit and MR conventions. Immediately persist the resolved MR URL in
the ticket's `links` through [transition ticket](transition-ticket.md)'s *Links-only write*: pass
the ticket UUID and MR, with no destination. Preserve existing links, deduplicate by URI, and verify
the saved MR before publishing the coding handoff, even when remaining in `working`. A link in a
comment alone does not satisfy this step. Working's `outtake` then publishes the coding handoff.
Resolve all applicable coding checks before reporting GREEN.

**How the MR lands.** Three properties are decided by the delivery, never left to a client default
or to the forge project's settings: **target** = the ticket's `base_branch` (a variant branch
targets the ticket branch); **squash commits** = enabled; **delete source branch** = enabled
**because the source is this ticket's own `branch_name`**, a short-lived branch whose whole purpose
was this MR and which the merge retires. That last one is the only conditional property: were the
source a long-lived or shared branch (`main`, `master`, `next`, `develop`, `stage`/`staging`, any
environment branch), a **release branch a later promote reuses**, or a branch that other open MRs
still target as their base, it would **not** be set. Here it always is — the `working` state opens
an MR *from the ticket's own branch*, by construction. The forge tools set the target when the MR
opens and send method and deletion explicitly at the merge, so nothing stored on the MR or the
project decides them.

The branch lands as one commit. Squash discards the branch commit trailers; [merge](merge.md)
preserves the ticket reference in the squash body. The MR title and description carry no
bakers.build reference. Explicit target and deletion properties protect parent/shared branches and
keep short-lived work branches from accumulating.

At review, supply the original review method with that confirmed ticket content, pinned base and
head, purpose-built diff context, and recorded evidence. No repository spec file is needed.
Reuse valid evidence; rerun a check when a new change, failure, or unresolved concern warrants it,
or when the user requests it. Record added evidence and the independent verdict in the ticket.
