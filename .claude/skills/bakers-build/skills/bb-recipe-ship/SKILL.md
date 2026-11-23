---
name: bb-recipe-ship
description: Recipe for tickets of type ship — bring a frozen batch to one target branch through one merge request.
---

# Ship

Writes follow `ticket-writes.md`; tool operations follow the frame's tool discovery and fallback.

The ticket's `environments` entry is the target (`branch`, `base_url`), `base_branch` the source.
`main` is the **release environment**. The **deploy steps** (deploy watch, login check) run only
for a target with a `base_url`. The project's WORKFLOW.md `## bb-phase-work` *Ship* hint names the
**version command** and the **npm package**. Missing ones are **skipped**; plan and summary say
which and why (`no base_url`, `no version command`, `no npm package`).

## bb-gates

| Type | Gates |
|---|---|
| ship | default |

## bb-state-plan

### bb-phase-work

0. Without a ticket environment, add the `bakers_project_read` `environments` entry the ticket
   names (name or branch) **by name**, never a branch, with `bakers_ticket_update`
   `environments_add`; the readback `target_branch` must equal its `branch`. Else stop, naming
   the missing environment.
1. Target equals source: stop.
2. Freeze the candidate once: `forge_fetch` (target in `branches`), then the SHA of
   `origin/<base_branch>`; an existing `origin/<branch_name>` keeps its head.
3. Compute the ticket batch between target and frozen SHA; report unresolved identifiers.
4. Read the SHA's pipeline (`forge_checks`, `ref` the SHA).
5. Release environment: the version command's dry run on the SHA gives next version and notes;
   empty output: stop. Apply the hint's blocking rules.

### bb-phase-deliver

One `plan` comment, no `spec` or `test`: target, frozen SHA, batch, gate status, skipped steps
and, on the release environment, version and notes draft. Approval authorizes that release and
version. Push nothing before it.

## bb-state-working

### bb-phase-work

A ship ticket builds nothing: skip the remote base check. On `branch_name`
(`release/<identifier>`): `forge_fetch`, `git reset --hard <frozen SHA>`, then `forge_push`
(`force_with_lease` once it exists). It carries no commit of its own; `main` merges the frozen
commit.

### bb-phase-deliver

1. Open one merge request with `forge_pr_upsert` into `target_branch`, titled
   `chore(release): x.y.z` with the approved version, else `chore(ship): <target branch>`. Call
   `forge_checks` until `overall` is `success`, then `forge_merge` (target's merge rule; `main`:
   merge commit, source kept). The frame's merge never runs here;
   nothing merges back into the source.
2. Pending, failed or refused: publish an honest `summary`; STOP.
3. Deploy steps: watch the deploy of the merged SHA (`forge_checks`, `ref` that SHA), then expect
   HTTP 200 from `<base_url>/user/login`. Then `bakers_ticket_update` this ticket only with
   `referenced_tickets_add` (the batch).
4. Release environment: once the `release` job tagged `vx.y.z` on the frozen SHA (its release
   carries the merge request's `### Upgrade notes` and `### Known open issues`), link the forge's
   release, named GitHub or GitLab, in `links` once the frame's release-read operation verifies
   it; verify npm package `x.y.z` is published.

### bb-phase-transition

Review is mandatory.

## bb-state-review

### bb-phase-work

Verdict: pipeline green on the merged SHA, batch complete and recorded here,
target responding after the deploy steps. Release environment additionally: tag `vx.y.z` on the
frozen SHA, forge release linked, npm package `x.y.z` published (verified).

### bb-phase-transition

Nothing is left to merge. On `OK`, `done`.
