# Forge operations

Read before any step that fetches from or writes to the hosting service: fetch, push, open or
update the MR, read its checks, merge.

## The rule

When the `forge_*` conductor tools are served, every forge operation goes through them, in every
permissions mode. They act on the calling run's ticket: its `branch_name`, variants
`<branch_name>-<suffix>`, and the base each merges into (`base_branch` for the ticket branch, the
ticket branch for a variant). The conductor holds the token, so the run never needs one.

| Operation | Tool |
|---|---|
| Fetch the base, the ticket branch and parent branches | `forge_fetch`, with parent-linked tickets' branches in `branches`; then rebase or merge locally with `git` |
| Push the ticket branch or a variant | `forge_push`; after a rewrite `force_with_lease: true` |
| Open the MR, or update its title and description | `forge_pr_upsert` |
| Read checks and pipeline jobs | `forge_checks`; call again until `overall` is `success` or `failure` |
| Merge, at authorized `done` | `forge_merge` |

A refusal names its rule (ownership, title, target, conflict, a required check): fix that and call
again. The tools guarantee the delivery properties: the MR targets the derived base, the title is a
Conventional Commits subject, the merge sends method and source deletion explicitly from the
project's merge rules, keeps a source other open MRs target, and ends the commit body with
`Merged-by: bakers.build` and final-line `ref:<identifier>`.

## Fallback

When no `forge_*` tool is served, run the same operation with `git` and the hosting service's
CLI or API, keeping every property above yourself. In `sandbox` permissions that needs the
commands in the project's trusted commands; without them stop at deliver and hand the push, MR
and merge to a human.
