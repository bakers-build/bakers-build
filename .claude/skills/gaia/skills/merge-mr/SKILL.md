---
name: merge-mr
description: "Execute an authorized merge: gate the MR, preserve its squash trailer and source-branch safety, verify the result."
---

# Merge the MR (gated)

Run in the parent for review's `OK → done` or authorized bug/chore coding skip-review.
Subagents hold no credentials. This capability writes no ticket state, runs no tests and
publishes no comments. `Not OK` and non-`done` destinations leave the MR unmerged.

## Input

- Resolved MR link from coding or persisted for review.
- **Required:** the calling ticket's `identifier` field, verbatim in canonical casing.
  Never construct a project prefix: `SHOP-42` becomes `ref:SHOP-42`.
- Context for the shared remote base check below.
- Explicit merge authorization, obtained or reused by the caller.

## Gates (each a hard block on `done`)

1. Resolvable MR link present.
2. **Pipeline green:** latest MR pipeline succeeded, including required manual jobs.
   Red, running or pending required jobs block.
3. No merge conflict; MR mergeable against its target.
   Verify the MR target equals the ticket's resolved `base_branch`; a target mismatch blocks.
   After these preconditions and source-branch safety checks, immediately before the merge mutation,
   run the [remote base check](../method-context/references/prior-art-build.md).
   `prior_art_hit` or an unresolved check error returns `blocked`.
4. Merge call succeeds, followed by verified results below.

Evaluate preconditions before merging. Report the first failed gate with its reason and remedy.

## Merge

Send **squash commits** and the **delete source branch** decision explicitly on this merge call;
omission inherits stored MR/project values.

Check the source. Delete only the merged ticket's own short-lived work branch. Retain long-lived,
shared and environment branches, release branches a later promote reuses, and branches that other
open MRs target as their base. Forge protection is not a substitute for this check.

For an eligible source, either client form satisfies these properties:

```bash
glab mr merge <mr> --squash --remove-source-branch \
  --squash-message "$(printf '%s\n\n%s\n%s' '<subject>' 'Merged-by: GAIA' 'ref:<identifier>')"
```

GitLab API: `PUT /projects/:id/merge_requests/:iid/merge` with `squash: true`,
`should_remove_source_branch: true`, and `squash_commit_message` containing the same lines.

For retained sources, use the API to send `should_remove_source_branch: false`; a false glab flag
can omit the field. A stored `force_remove_source_branch: true` overrides this negative: block
until the branch owner decides to clear it before merge. Keep squash enabled.

`<subject>` comes from the MR title, which carries no GAIA reference. Squash discards individual
commit trailers, so put `Merged-by: GAIA` and final-line `ref:<identifier>` in the squash body;
otherwise release measurement silently loses the ticket. Use `--squash-message`:
`-m`/`--message` sets the merge commit, not the squash commit representing the change.

Verify that the MR reports merged and its target advanced.

## Outcome

Return exactly **merged** (verified success; caller may transition to `done`) or **blocked**
(failed gate and actionable reason; caller must not transition), with the shared check evidence.
If an earlier gate blocks, the check outcome is `not_run`.

## Caller handoff

Before any final transition, append returned check evidence to the typed handoff and updated
summary, preserving earlier verdict/evidence. On `prior_art_hit`, stop and ask for a decision.
A state restriction leaves the check `not_run`.
