The merge runs through [forge operations](forge.md). For GitHub, [GitHub delivery](github-delivery.md)
adds its specifics; shared gates and handoff still apply.

# Merge the MR (gated)

Run in the parent only at authorized `done`; otherwise leave unmerged. No tests, comments or ticket
state writes.

## Input

- Resolved MR link from coding or persisted for review.
- **Required:** the calling ticket's `identifier` field, verbatim in canonical casing.
  Never construct a project prefix: `SHOP-42` becomes `ref:SHOP-42`.
- Context for the shared remote base check below.
- Explicit merge authorization, obtained or reused by the caller.

## Gates (each a hard block on `done`)

1. Resolvable MR link present. Its title is a Conventional Commits subject `type(scope)!: subject`,
   `^(feat|fix|chore|docs|refactor|test|ci|build|perf)(\([a-z0-9._/-]+\))?!?: \S.*`; any other title
   blocks, naming this rule and a conforming retitle (`feat(stats): …`).
2. **Pipeline green:** latest MR pipeline succeeded, including required manual jobs.
   Red, running or pending required jobs block.
3. No merge conflict; MR mergeable against its target.
   Verify the MR target equals the ticket's resolved `base_branch`; a target mismatch blocks.
   After these preconditions and source-branch safety checks, immediately before the merge mutation,
   run the [remote base check](prior-art-build.md).
   `prior_art_hit` or an unresolved check error returns `blocked`.
4. Merge call succeeds, followed by verified results below.

Report the first failure and remedy.

## Merge

Send **squash commits** and the **delete source branch** decision explicitly on this merge call;
omission inherits stored MR/project values.

Check the source. Delete only the merged ticket's own short-lived work branch. Retain long-lived,
shared and environment branches, release branches a later promote reuses, and branches that other
open MRs target as their base. Forge protection is not a substitute for this check.

For retained sources, send the deletion negative explicitly. A stored
`force_remove_source_branch: true` overrides this negative: block until the branch owner decides
to clear it before merge. Keep squash enabled.

The subject comes from the MR title, which carries no bakers.build reference: the validated title,
verbatim. Squash discards individual commit trailers, so put `Merged-by: bakers.build` and
final-line `ref:<identifier>` in the squash body; otherwise release measurement silently loses the
ticket. The message goes on the squash commit, the one that represents the change.

`forge_merge` guarantees every property in this section; its refusal names the failed one.

Verify that the MR reports merged and its target advanced.

## Outcome

Return exactly **merged** (verified success; caller may transition to `done`) or **blocked**
(failed gate and actionable reason; caller must not transition), with the shared check evidence.
If an earlier gate blocks, the check outcome is `not_run`.

## Caller handoff

Before any final transition, append returned check evidence to the typed handoff and updated
summary, preserving earlier verdict/evidence. On `prior_art_hit`, stop and ask for a decision.
A state restriction leaves the check `not_run`.
