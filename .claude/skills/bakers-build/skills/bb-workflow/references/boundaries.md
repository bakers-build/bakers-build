# Boundaries of a recipe state

Read at the start of `work` in `plan`, `working` and `review`.

## Audience and register

Read `.bakers/audience.local.md` when present. Apply its vocabulary; otherwise use a developer-neutral
register. Personal expertise stays out of shared files. Deliverables follow their intended audience.

## Tracker context and confirmed scope

Supply bakers.build, ticket UUID and confirmed `spec`, `plan`, `test` comments to the recipe's
skills. Proposals carry scope markers and proposal/confirmed status. Record exact confirmed comment
IDs and covering approval. Later proposals supersede scope only after approval. Publish complete
plans in the ticket through [publish comment](publish-comment.md); product docs remain in the
repository.

## Project checks and functional validation

Apply matching `WORKFLOW.md` `bb-phase-validate` rows and the `bb-phase-provision` setup;
deduplicate commands. An absent section means none. Separate Project checks and Functional
validation in the test plan. Use [result records](results.md) for personas, modes, expected
observations, execution status, coverage and evidence. Lint alone does not prove functional
acceptance.

## Authorization and state boundary

Resolve material choices; reuse approval covering scope, implementation and verification plans.
Honor state restrictions. A recipe's activity beyond the current state waits for that state; for
example, `working` hands review context to `review`. Apply the [coding gate](coding-gate.md) before
leaving `working`. Merge/deployment require explicit concrete authorization; prepare the MR first.
Origin messages require send authorization. Read [terminal retrospective](retrospective.md) only for
eligible terminal decisions.

## Review's closed repair list

Only the parent may repair linter/formatter autofixes, documentation wording or spec/acceptance
alignment. Never behavior, tests or schema/config. Rerun affected checks and publish evidence.
