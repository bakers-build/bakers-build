# GitHub delivery

Use for a project's GitHub repository. These notes add GitHub's specifics to [delivery](delivery.md)
and [merge](merge.md); their gates, authorization, state boundaries, ticket-link persistence and
caller handoff apply unchanged, and every operation runs through [forge operations](forge.md).

## Open

Push the scoped work and open the PR into the derived base. Keep the Conventional Commits title and
description free of bakers.build references. Save the verified PR URL through delivery's links-only
write. GitHub stores neither a per-PR squash preference nor a per-PR source deletion preference, so
both are decided at the merge.

## Merge

Only run when the calling state explicitly authorizes merge. Apply every shared merge gate:
latest required checks at the expected head succeeded, no conflict, correct base, then the remote
base check immediately before mutation. Failed, skipped or pending required checks block.

Feature work squash-merges: the subject is the validated PR title, the body carries
`Merged-by: bakers.build` and final-line `ref:<identifier>`, with the calling ticket's identifier
verbatim.

An explicitly authorized stable promotion follows the project's required merge method, parent and
tree rules instead (the project's merge rule for that base). Never squash a promotion whose second
parent identifies the release.

Verify the merge and target advancement. The source ref goes only when it is the ticket's own
short-lived branch, is not shared or an environment branch, is not reused for promotion, and no
open PR targets it. Keep `next`, `main` and other long-lived branches. Protection alone does not
establish deletion safety. Report a deletion failure separately; never repeat a successful merge to
retry cleanup.

Return the shared merge outcome and evidence. No ticket transition happens here.
