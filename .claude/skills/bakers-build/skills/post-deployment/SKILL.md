---
name: post-deployment
description: Own the post_deployment step — monitor a deployment, stamp its environment onto the delivered ticket batch, and transition to done.
when:
  workflow: [bb_deployment]
  step: [post_deployment]
inputs:
  health.prompt:
    description: how to monitor the target-branch deploy and health-check the deployed site
    default: monitor the target-branch deploy via `glab ci status --branch <branch>`, then health-check `GET <base_url>/user/login` expecting HTTP 200
---

# Post deployment

Monitor the target deploy using the effective `health.prompt` under `WORKFLOW.md` › **Required skills**.
Only verified deploy success for the candidate SHA and a passing configured health check permit
stamping delivered tickets and completing. Publish the full domain result as one parent-authored
`summary` under `@bakers-build/workflow-step`; choose no automatic rollback.

## Resolve the target environment

From the deployment's `environments` relationship (the target set at creation), read the related
`bb_environment` to get its uuid, `branch`, and `base_url`.

## Monitor the deploy

Verify the target-branch deploy for the prepared candidate SHA has succeeded, then execute the
configured health check. Failed, running, unknown or mismatched outcomes publish an honest summary
and remain in `post_deployment`, with no new delivered-ticket stamps and no transition. Keep the
deployment ticket's target environment relationship; it records the target, not successful delivery.

## Stamp the batch (the deployed-marker)

For **each `referenced_tickets` entry AND the deployment ticket itself**, append the target env
to `environments` via **read-modify-write union**: read the ticket's existing env set, union in
the target env uuid, and write the union. **Never clobber existing environments** — nothing
already on the ticket is dropped. This marker records verified delivery. Release batches are measured from commit deltas, not these markers. Preserve historical markers unchanged.

## Summarize

Publish a structured `summary` covering the monitored deploy, the batch flagged with the target
env (identifiers), the target environment, and the pipeline / health-check result recorded
honestly (including a still-running or non-200 outcome).

Never expose credentials and never let a subagent publish comments.

## Run flow (step: post_deployment)

You own the `post_deployment` step. Do only this flow, then STOP.

1. Invoke `@bakers-build/read-ticket`, including all comments.
2. Invoke `@bakers-build/run-intake` to frame this run (the deployment scope, target environment, resumed
   inputs).
3. Verify the candidate deploy and configured health check; only on success stamp the target
   environment onto the referenced tickets and this ticket as described above, using the project's
   `health.prompt` input.
4. Invoke `@bakers-build/run-outtake` to render the run handoff, leading with the deploy health result and
   the stamped environment.
5. Invoke `@bakers-build/publish-origin-status` with `done`.
6. Invoke `@bakers-build/transition-ticket` with destination `done` as the final action under `@bakers-build/workflow-step`.
7. Stop. Do not start or prepare any later work.
