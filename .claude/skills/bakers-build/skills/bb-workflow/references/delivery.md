## Coding and review handoff

Commit and push the scoped change, then create or update its MR with explicit
`--target-branch <base_branch>`. Follow project commit and MR conventions. Immediately persist
the resolved MR URL in the ticket's `links` through `@bakers-build/bb-transition-ticket`'s *Links-only write*:
pass the ticket UUID and MR, with no destination. Preserve existing links, deduplicate by URI,
and verify the saved MR before publishing the coding handoff, even when remaining in `working`.
A link in a comment alone does not satisfy this step. Publish a coding
handoff containing confirmed scope IDs, MR, base and head SHAs, and per-criterion evidence.
Resolve all applicable coding checks before reporting GREEN.

**How the MR is opened.** Three properties are set **on the MR itself**, never left to a client
default or to the forge project's settings: **target** = the ticket's `base_branch`; **squash
commits** = enabled; **delete source branch** = enabled **because the source is this ticket's own
`branch_name`**, a short-lived branch whose whole purpose was this MR and which the merge retires.
That last one is the only conditional property: were the source a long-lived or shared branch
(`main`, `master`, `develop`, `stage`/`staging`, any environment branch), a **release branch a later
promote reuses**, or a branch that other open MRs still target as their base, it would **not** be
set. Here it always is — the `working` state opens an MR *from the ticket's own branch*, by
construction.

| Property | GitLab API (`POST /projects/:id/merge_requests`) | `glab mr create` |
|---|---|---|
| target | `target_branch` | `-b, --target-branch` |
| squash commits | `squash: true` | `--squash-before-merge` |
| delete source branch | `remove_source_branch: true` | `--remove-source-branch` |

Both columns are **illustrations of clients that satisfy the properties**, not a prescription — the
properties are the instruction, and any client that sets all three conforms. That matters because
`glab` is absent on some machines: an agent holding only the API is conforming from the left column
alone.

The branch lands as one commit. Squash discards the branch commit trailers; `@bakers-build/bb-merge-mr` preserves the ticket reference in the
squash body. The MR title and description carry no bakers.build reference. Explicit target and deletion
properties protect parent/shared branches and keep short-lived work branches from accumulating.

At review, supply the original review method with that confirmed ticket content, pinned base and
head, purpose-built diff context, and recorded evidence. No repository spec file is needed.
Reuse valid evidence; rerun a check when a new change, failure, or unresolved concern warrants it,
or when the user requests it. Record added evidence and the independent verdict in the ticket.

