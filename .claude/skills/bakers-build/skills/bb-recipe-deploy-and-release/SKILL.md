---
name: bb-recipe-deploy-and-release
description: Recipe for tickets of type deployment — merge a frozen batch into one environment through one merge request; on `main` the `release` job tags the version and creates the GitLab release.
---

# Deploy and release

Writes follow `ticket-writes.md`.

The ticket's `environments` entry is the target (`branch`, `base_url`), `base_branch` the source.
`main` is the **release environment**.

## bb-state-plan

### bb-phase-work

1. Target equals source: stop; nothing to merge.
2. Freeze the candidate once: `forge_fetch`, target in `branches`
   (the frame's forge operations), then the SHA of `origin/<base_branch>`;
   an existing `origin/<branch_name>` keeps its head.
3. Compute the deployment ticket batch between the target branch and frozen SHA through the
   frame's tool discovery and fallback; report unresolved
   identifiers.
4. Read the SHA's pipeline (`forge_checks`, `ref` the SHA).
5. Release environment: `pnpm --dir bakers-cli run release:version <SHA> --notes -` is the dry
   run: next version and notes since the last reachable `v*` tag. Empty output: stop.
   Block when a breaking
   (`!`) server commit is in the batch and none raises `min_client_version`: raise it in a merge
   request on `develop`, then freeze again.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, frozen SHA, batch, gate status and, on the release
environment, version and notes draft. Approval authorizes that release and version. Push nothing before it.

## bb-state-working

### bb-phase-work

A deployment builds nothing: skip the remote base check. The ticket's `branch_name`
(`release/<identifier>`) is checked out: `forge_fetch`, `git reset --hard
<frozen SHA>`, then `forge_push` (`force_with_lease` once it exists). It carries no commit of its
own; `main` merges the frozen commit.

### bb-phase-deliver

1. Open the release branch's one merge request with `forge_pr_upsert`, titled
   `chore(release): x.y.z` with the approved version (other targets: `chore(deploy): <target
   branch>`); it targets the ticket's `target_branch`. Call `forge_checks` until `overall` is
   `success`, then `forge_merge` (target's merge rule; `main`: merge commit, source kept).
   GitLab's manual gate operation follows the frame's tool discovery and fallback before merge. The
   frame's merge never runs here; nothing merges back into `develop`.
2. Pending, failed or refused: publish an honest `summary` and STOP.
3. Watch the deploy of the merged SHA (`forge_checks`, `ref` that SHA), then expect HTTP 200
   from `<base_url>/user/login` (deployed login smoke check in the frame's tool discovery and fallback).
   Then call `bakers_ticket_update` on this ticket only, with
   `environments_add` (the target) and `referenced_tickets_add` (the batch): this ticket is the
   record of where its batch is deployed.
4. Release environment: once the `release` job tagged `vx.y.z` on the frozen SHA, add its GitLab
   release to `links` only after the release-read operation in the frame's tool discovery and fallback
   verifies it.

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict on the deployment: pipeline green on the merged SHA, the target responds, the batch is
complete and recorded on this ticket. Release environment additionally: tag `vx.y.z` on the frozen
SHA, its GitLab release linked in `links`, the CLI package `x.y.z` published on npm.
Verify publication through the frame's tool discovery and fallback.

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
