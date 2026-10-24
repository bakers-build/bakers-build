---
name: prepare-deployment
description: Own pre_deployment — authorize, freeze/promote, gate, merge and measure a release, then confirm post_deployment.
when:
  workflow: [bb_deployment]
  step: [pre_deployment]
inputs:
  release.prompt:
    description: Project release naming, freeze/promote topology, required jobs, merge target and commit signature.
    default: |
      Release branch `release/<date>-<bakers.build-nnn>`: first deploy freezes origin/develop; later deployments reuse it byte-identically. After branch creation, open its merge request and verify the gate in that merge request's pipeline on the exact SHA: a played, green `gate` with its `build`, `phpunit`, `e2e` and `config_install` jobs, via `glab ci status`; an unplayed gate is not green. Merge develop-cut → staging, promote → main; commit `release: <env> <date> — <n> tickets`.
---

# Prepare deployment

## Run flow (step: pre_deployment)

1. Invoke `@bakers-build/read-ticket`, including comments, then `@bakers-build/run-intake` for release scope,
   environment, gate and resumed inputs. Resolve `release.prompt` under `WORKFLOW.md` ›
   **Required skills**; its project policy governs the mechanics below.
2. Resolve the single `environments` relationship: read its UUID, `branch` and `base_url`.
   If empty or 404, follow [target environment](references/target-environment.md).
   Read the ticket's release source `base_branch` and release `branch_name`.
3. Obtain or reuse explicit authorization for this concrete release before creating/pushing
   or merging. Fetch origin; distinguish confirmed branch absence from network/permission failure.
   **FREEZE:** absent `branch_name` → capture `git rev-parse origin/<base_branch>` once,
   create/push at that SHA. **PROMOTE:** existing branch → reuse its immutable SHA; never re-cut.
4. After the branch exists, gate its exact candidate SHA pipeline. Every required job,
   including manual jobs, must execute and pass. Pending, skipped, unstarted, failed or
   SHA-mismatched jobs block merge/transition: publish an honest parent-authored `summary` and
   STOP. Retain the frozen branch. For regressions, use `@bakers-build/create-ticket` prior-art/reconciliation.
5. Refresh `git fetch origin`; capture `PREV=$(git rev-parse origin/<env.branch>)` before merging.
   Merge `branch_name → <env.branch>` using `release.prompt` topology/signature; this triggers deployment.
   After a remote-side merge, fetch again. Use remote-tracking refs throughout. Gather the actual
   merge delta, never all `done` tickets or hand-parsed logs:

   ```bash
   bakers deployment tickets --since "$PREV" --to origin/<env.branch>
   ```

6. Output is `{range, resolved[], unresolved[]}` (deduplicated, first-seen). Empty delta or
   empty/uncertain resolved batch → summary and STOP, preserving any existing batch.
   Otherwise replace `referenced_tickets` once with the full JSON:API `resolved[].uuid` relationship
   array. Report and skip unresolved identifiers; they are nonfatal.
7. Publish `summary`: resolved/unresolved identifiers, environment, freeze/promote, merge/MR link,
   pipeline evidence and executed manual jobs. Other links/relationships use read-modify-write
   unions by `uri`; only the measured nonempty batch replaces. Never expose credentials or let
   subagents publish comments.
8. Print the step-7 summary in full (`@bakers-build/run-outtake`), leading with
   batch/environment. Ask the human to confirm the prepared release. After
   confirmation invoke `@bakers-build/publish-origin-status` with `post_deployment`, then
   `@bakers-build/transition-ticket` with destination `post_deployment` as the final action
   under `@bakers-build/workflow-step`. STOP; do not prepare subsequent work.
