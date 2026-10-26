---
name: bb-recipe-deploy-and-release
description: Recipe for tickets of type deployment — merge a frozen batch into one environment through a release branch; on `main` also version, changelog and back-merge with commit-and-tag-version.
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
5. Release environment: `pnpm --dir bakers-cli run bump --dry-run` gives the next version
   (`VERSION`) and `CHANGELOG.md` section since the last reachable `v*` tag. Block when a breaking
   (`!`) server commit is in the batch and none raises `min_client_version`: raise it in a merge
   request on `develop`, then freeze again.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, frozen SHA, batch, gate status and, on the release
environment, version and changelog draft. Its approval authorizes the release and its version; the
approver may override the version (`--release-as <x.y.z>`). Cut no branch before it.

## bb-state-working

### bb-phase-work

A deployment builds nothing: skip the remote base check. Cut `release/<date>-<identifier>` at the
frozen SHA, or reuse it when it exists, and record it as `branch_name`. Release environment: run
`pnpm --dir bakers-cli run bump` (plus the approved `--release-as`) on it. It bumps `VERSION`, writes the
`CHANGELOG.md` section and commits `chore(release): x.y.z`; it creates no tag. Push.

### bb-phase-deliver

In this order, each merge request with a played gate:

1. Open the release branch's merge request into the target branch, titled `chore(release): x.y.z`
   (other targets: `chore(deploy): <target branch>`). Play its `gate`; once green, merge by merge
   commit: `glab api -X PUT projects/:id/merge_requests/<mr>/merge -F squash=false -F should_remove_source_branch=false`.
   The frame's merge never runs here.
2. Release environment: open the back-merge merge request, same title, into `develop`.
   When `develop` moved since the freeze, merge `develop` into the release branch first. Same gate,
   same merge commit. `main` is never merged into `develop`.
3. An unplayed, running or red gate blocks its merge: publish an honest `summary` and STOP.
4. Watch the deploy of the merged SHA (`glab ci status --branch <branch>`), then expect HTTP 200
   from `<base_url>/user/login`. Then union the target into `environments` of each batch ticket and
   this one, and write the batch as `referenced_tickets`.
5. Release environment: once the `release` job tagged `vx.y.z`, add its GitLab release to `links`.

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict on the deployment: pipeline green on the merged SHA, the target responds, the batch is
complete and stamped. Release environment additionally: tag `vx.y.z` on the `chore(release)`
commit, its GitLab release linked in `links`, the CLI package `x.y.z` on npm (`npm view`), the
back-merge on `develop`.

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
