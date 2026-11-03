# GitHub delivery

Use for a project's GitHub repository. These instructions replace only the GitLab client
operations in [delivery](delivery.md) and [merge](merge.md), not their gates, authorization,
state boundaries, ticket-link persistence or caller handoff.

## Open

Commit and push the scoped work. Create/update a PR with explicit base and head:
`gh pr create --base <base_branch> --head <branch_name>`. Keep the Conventional Commits title and
description free of bakers.build references. Save the verified PR URL through delivery's links-only
write. GitHub stores neither a per-PR squash preference nor a per-PR source deletion preference.

## Merge

Only run when the calling state explicitly authorizes merge. Apply every shared merge gate:
latest required checks at the expected head succeeded, no conflict, correct base, then the remote
base check immediately before mutation. Failed, skipped or pending required checks block.

For feature work, call `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with structured JSON:
expected head `sha`, `merge_method: squash`, `commit_title` equal to the validated PR title,
and `commit_message` containing `Merged-by: bakers.build` and final-line `ref:<identifier>`.
Copy the calling ticket's identifier verbatim.

An explicitly authorized stable promotion follows the project's required merge method, parent and
tree rules instead. Never squash a promotion whose second parent identifies the release.

Verify `merged: true`, resulting commit and target advancement. Then delete the source ref only
if it is the ticket's own short-lived branch, is not shared or an environment branch, is not reused
for promotion, and no open PR targets it. Keep `next`, `main` and other long-lived branches.
Protection alone does not establish deletion safety. Report deletion failure separately; never
repeat a successful merge to retry cleanup.

Return the shared merge outcome and evidence. No ticket transition happens here.
