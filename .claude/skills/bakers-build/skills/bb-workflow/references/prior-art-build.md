# Prior art — remote base check

Inputs: ticket, creation date, ask, base_branch, paths (derive at qualification). Fresh `forge_fetch`
under [forge](forge.md);
inspect success before searching. A failed fetch stops with `error`, never a stale negative.
Search **origin/<base_branch>**, not local HEAD:

```bash
git log --oneline "origin/<base_branch>" --since='<ticket created>'
git grep -nEi '<domain-noun>|<second spelling>' "origin/<base_branch>" -- <paths>
git grep -c '<known-present term>' "origin/<base_branch>" -- <same paths>
git rev-parse "origin/<base_branch>"
```

Inspect each status: grep 1 means no match, 128 means unresolved revision; log 0 may be empty.
Empty search needs a positive probe. Confirm candidates with diff stat **and current tree**;
a subject or nonempty diff alone proves no delivery, and reverted behavior is absent.
Exclude this ticket's own work only.

Candidate ticket lookup also applies during merge. Resolve the candidate commit's `ref:` trailer
using `git log -1 <sha> --format='%h %s%n%b'`; with no candidate, sweep
`git log origin/<base_branch> --grep='^ref:' -i --format='%h %s%n%b' -20`.
Keep body for identifiers (any project key). Read candidates under
[read ticket](read-ticket.md) for identifier, title, state and assignee. Missing trailer/metadata
cannot make observed delivery negative: report the unresolved identity as blocking.

Return `negative`, `prior_art_hit`, `error` or `not_run`. Except not_run (checkpoint and reason),
record checkpoint, remote branch, exact terms/paths, command statuses, probe, full checked SHA,
candidates, MR/merge and reasoning. Negative requires successful search and candidate inspection.
Errors block. On a hit build nothing: return candidate report to caller, which stops and asks.
This check publishes nothing and takes no confirmation itself.
