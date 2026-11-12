# Merge the MR (gated)

Parent only, at explicitly authorized done. Use [forge](forge.md); no tests/comments/state writes here.

## Input

**Required:** the calling ticket's `identifier` field, verbatim in canonical casing.
Resolved MR link and explicit merge authorization, obtained or reused by the caller.
Never construct a project prefix: `SHOP-42` becomes `ref:SHOP-42`.
Supply [remote base check](prior-art-build.md) context.

## Gates (each a hard block on `done`)

1. Resolvable MR link present. Its title is a Conventional Commits subject; invalid title blocks with a conforming retitle.
2. **Pipeline green:** latest MR pipeline succeeded, including required manual jobs.
   Red, running or pending required jobs block. For GitHub, require checks at the expected head;
   skipped required checks also block.
3. No merge conflict; MR mergeable against its target.
   Verify the MR target equals the ticket's resolved `base_branch`; a target mismatch blocks.
   After these preconditions and source-branch safety checks, immediately before the merge mutation,
   run the [remote base check](prior-art-build.md).
   `prior_art_hit` or an unresolved check error returns `blocked`.
4. Merge call succeeds, followed by verified results below.

Report the first failure and remedy.

Return merged or blocked with first failure/remedy and check evidence; an unreached base check is
not_run. For stable promotion use project method/parent/tree rules; never squash when the release is
identified by the second parent; report cleanup failure separately,
never repeat a successful merge for cleanup. Without tools read [merge fallback](merge-fallback.md).

## Caller handoff

Before final transition append check evidence to typed handoff and updated summary, preserving
prior verdict/evidence. On prior_art_hit stop for a decision. State restriction leaves check not_run.
