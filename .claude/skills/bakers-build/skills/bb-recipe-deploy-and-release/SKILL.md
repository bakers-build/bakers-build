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
2. Freeze the candidate once: `git fetch origin`, then the SHA of `origin/<base_branch>`; an
   existing release branch keeps its head.
3. Batch: `bakers deployment tickets --since origin/<target branch> --to <SHA>`; report unresolved
   identifiers.
4. Read the SHA's pipeline (`glab ci status`).
5. Release environment: `pnpm --dir bakers-cli run release:version <SHA> --notes -` is the dry
   run of the `release` job: the next version, then the release notes, since the last
   reachable `v*` tag. No output means nothing to release: stop and say so. Block when a breaking
   (`!`) server commit is in the batch and none raises `min_client_version`: raise it in a merge
   request on `develop`, then freeze again.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, frozen SHA, batch, gate status and, on the release
environment, version and release notes draft. Its approval authorizes the release and its version,
which the commits fix. Cut no branch before it.

## bb-state-working

### bb-phase-work

A deployment builds nothing: skip the remote base check. Cut `release/<date>-<identifier>` at the
frozen SHA, or reuse it when it exists, and record it as `branch_name`. Push it as it is: it carries
no commit of its own, so the commit `main` merges is the frozen one.

### bb-phase-deliver

In this order:

1. Open the release branch's one merge request into the target branch, titled
   `chore(release): x.y.z` with the approved version (other targets: `chore(deploy): <target
   branch>`). Play its `gate`; once green, merge by merge commit:
   `glab api -X PUT projects/:id/merge_requests/<mr>/merge -F squash=false -F should_remove_source_branch=false`.
   The frame's merge never runs here, and nothing merges back into `develop`.
2. An unplayed, running or red gate blocks the merge: publish an honest `summary` and STOP.
3. Watch the deploy of the merged SHA (`glab ci status --branch <branch>`), then expect HTTP 200
   from `<base_url>/user/login`. Then union the target into `environments` of each batch ticket and
   this one, and write the batch as `referenced_tickets`.
4. Release environment: once the `release` job tagged `vx.y.z` on the frozen SHA, add its GitLab
   release to `links`.

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict on the deployment: pipeline green on the merged SHA, the target responds, the batch is
complete and stamped. Release environment additionally: tag `vx.y.z` on the frozen SHA, its GitLab
release linked in `links`, the CLI package `x.y.z` on npm (`npm view`).

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
