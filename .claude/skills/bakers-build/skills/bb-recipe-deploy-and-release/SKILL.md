---
name: bb-recipe-deploy-and-release
description: Recipe for tickets of type deployment — merge a frozen batch into one environment through one merge request; on `main` the `release` job tags the version and creates the GitLab release.
---

# Deploy and release

The ticket's one `environments` entry is the target (`branch`, `base_url`), its `base_branch` the
source. A target whose `branch` is `main` is the **release environment**.

## bb-state-plan

### bb-phase-work

1. A target `branch` equal to `base_branch` leaves nothing to merge: stop and say so.
2. Freeze the candidate once: `forge_fetch`, target in `branches`
   ([forge operations](../bb-workflow/references/forge.md)), then the SHA of `origin/<base_branch>`;
   a pushed `origin/<branch_name>` keeps its head.
3. Batch: `bakers deployment tickets --since origin/<target branch> --to <SHA>`; report unresolved
   identifiers.
4. Read the SHA's pipeline (`forge_checks`, `ref` the SHA).
5. Release environment: `pnpm --dir bakers-cli run release:version <SHA> --notes -` is the dry
   run of the `release` job: the next version, then the release notes, since the last
   reachable `v*` tag. No output means nothing to release: stop and say so. Block when a breaking
   (`!`) server commit is in the batch and none raises `min_client_version`: raise it in a merge
   request on `develop`, then freeze again.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, frozen SHA, batch, gate status and, on the release
environment, version and release notes draft. Its approval authorizes the release and its version,
which the commits fix. Push nothing before it.

## bb-state-working

### bb-phase-work

A deployment builds nothing: skip the remote base check. The ticket branch (`branch_name`,
`release/<identifier>`) is checked out in the worktree: `forge_fetch`, `git reset --hard
<frozen SHA>`, then `forge_push` (`force_with_lease` once it exists). It carries no commit of its
own, so the commit `main` merges is the frozen one.

### bb-phase-deliver

In this order:

1. Open the release branch's one merge request into the target branch, titled
   `chore(release): x.y.z` with the approved version (other targets: `chore(deploy): <target
   branch>`). Play its `gate`; once green, merge by merge commit, sending squash off and source
   deletion off explicitly, as the forge fallback (its target is not `base_branch`). The
   frame's merge never runs here, and nothing merges back into `develop`.
2. An unplayed, running or red gate blocks the merge: publish an honest `summary` and STOP.
3. Watch the deploy of the merged SHA (`forge_checks`, `ref` that SHA), then expect HTTP 200
   from `<base_url>/user/login`. Then call `bakers_ticket_update` on this ticket only, with
   `environments_add` (the target) and `referenced_tickets_add` (the batch): this ticket is the
   record of where its batch is deployed.
4. Release environment: once the `release` job tagged `vx.y.z` on the frozen SHA, add its GitLab
   release to `links`.

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict on the deployment: pipeline green on the merged SHA, the target responds, the batch is
complete and recorded on this ticket. Release environment additionally: tag `vx.y.z` on the frozen
SHA, its GitLab release linked in `links`, the CLI package `x.y.z` on npm (`npm view`).

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
