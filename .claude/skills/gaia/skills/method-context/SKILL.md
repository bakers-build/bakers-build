---
name: method-context
description: "GAIA context adapter for a selected original engineering method: ticket scope, check configuration, publication, and authorization boundaries."
---

# Integrate the engineering method

Read project `WORKFLOW.md`: Skill set selects the method; Skills selects required additions;
Checks and Setup select commands and prerequisites. Resolve references against this installation.

## Selecting the skill set

Recognize Markdown links or `@gaia/method-context` references under `Skill set`. The first entry
is default; names are reference basenames without `.md`. A reference starts with a heading ending
in `skill set`; its blockquote supplies the choice description.

Qualification chooses once: one available entry needs no question; multiple entries offer all
available sets with the first as default. Show unavailable choices and installation instructions.
An unattended run or declined choice uses the first available set; a pending answer is not a decline.
Qualification selects but does not execute the method.

### Recording the choice

Persist one `method:<set>` label in `gaia_labels`, preserving other labels. Use qualify-ticket's
idempotent term creation with `--workspace_id` from `gaia info` and description
`Engineering method: the '<set>' skill set listed in WORKFLOW.md › Skill set.`
Reuse confirmed choices; record confirmed/default status in the typed qualification handoff.
Later states resolve the standing label or first available default. Changes follow `@gaia/scope-change`.

## Audience and register

Read `.gaia/audience.local.md` when present. Apply its vocabulary; otherwise use a developer-neutral
register. Personal expertise stays out of shared files. Deliverables follow their intended audience.

## Loading the selected skills

Read complete current-step method skills and applicable references using host discovery/installation.
Honor explicit-only invocation. Report sources loaded. An unavailable required skill stops dependent
work with its exact identifier and installation remedy. Load only matching conditional skills.

## Tracker context and confirmed scope

Supply GAIA, ticket UUID and confirmed `spec`, `plan`, `test` comments. Proposals carry scope markers
and proposal/confirmed status. Record exact confirmed comment IDs and covering approval. Later
proposals supersede scope only after approval. Publish complete plans in the ticket through
`@gaia/publish-comment`; product docs remain in the repository.

## Project checks and functional validation

Apply matching WORKFLOW Checks rows and setup; deduplicate commands. Missing section is unresolved;
an empty section means none. Separate Project checks and Functional validation in the test plan.
Use [result records](references/results.md) for actors, modes, expected observations, execution
status, coverage and evidence. Lint alone does not prove functional acceptance.

## Authorization and state boundary

Resolve material choices; reuse approval covering scope, implementation and verification plans.
Honor state restrictions. Apply the Coding gate before leaving coding. Merge/deployment require
explicit concrete authorization; prepare the MR first. Origin messages require send authorization.
Read [terminal retrospective](../transition-ticket/references/terminal-retrospective.md) only for
eligible terminal decisions.

## Review's closed repair list

Only the parent may repair linter/formatter autofixes, documentation wording or spec/acceptance
alignment. Never behavior, tests or schema/config. Rerun affected checks and publish evidence.

Before coding, read [remote base check](references/prior-art-build.md), then
[Coding flow and gate](references/coding.md) and [delivery](references/delivery.md).
For review, read [Review flow](references/review.md) and delivery.
