## Prior art — re-check the base branch before building

A sibling can deliver the ask between checkpoints; each invocation needs a fresh remote snapshot.
Inputs: ticket UUID/identifier, creation date, ask, resolved `base_branch` and relevant paths.
At qualification derive paths from the ask and repository; no implementation plan is required.
After `forge_fetch` ([forge operations](forge.md)), search the remote, never the local branch:

```bash
git log --oneline "origin/<base_branch>" --since='<ticket created>'
git grep -nEi '<domain-noun>|<second spelling>' "origin/<base_branch>" -- <relevant paths>
git grep -c '<term you know is there>' "origin/<base_branch>" -- <same paths>   # probe, for an empty grep
```

Inspect the fetch result first. A failed fetch returns `error` and stops the operation: later
local calls only describe a stale snapshot, never a verified negative.

An error is not a negative. `git grep` reports `unable to resolve revision` with exit 128;
exit **1** means no match. `git log` exits **0** even with no commits. Read each command's
status rather than its empty output. Confirm a candidate with
`git diff --stat <base>..origin/<base_branch>` and inspect the current tree.
An empty search needs its probe. Record the checked revision with
`git rev-parse "origin/<base_branch>"`. Commit subjects or a nonempty diff stat alone do not
prove delivery; a reverted change is not delivered behavior. Exclude
this ticket's own ticket/commit from sibling prior art; inspect other candidates normally.

Candidate ticket lookup is part of this check during merge too.

Resolve a candidate commit to its ticket through the `ref:` trailer the delivery convention
requires. The trailer carries an identifier, not a UUID, and [read ticket](read-ticket.md) owns that
resolution and the read — take the title, state and assignee from it rather than improvising a read
here:

```bash
# the candidate the grep above found — resolve that one commit, not recent history
git log -1 <candidate-sha> --format='%h %s%n%b'
# or, with no candidate yet, sweep the trailer across the base branch
git log "origin/<base_branch>" --grep='^ref:' -i --format='%h %s%n%b' -20
```

Keep `%b`: the `ref:` trailer is in the body. Search bare `ref:`, not one project key. Resolve the
candidate to identifier, title, state and assignee.

Missing trailer or candidate metadata cannot turn observed delivered behavior into a negative:
report the available evidence and unresolved identity as a blocking candidate.

**On a hit, build nothing.** The outcome is `prior_art_hit` with the report — identifier, title,
state, assignee, and the merge commit or MR — and it is the invoking step owner that stops and asks.
This context reports the outcome and takes **no confirmation of its own**.

## Check evidence

Outcomes are `negative`, `prior_art_hit`, `error` or `not_run`. `negative`, `prior_art_hit` and
`error` each report checkpoint, `origin/<base_branch>`, exact searched terms and path scope, command
statuses, probe result and the full checked revision when resolved before any error. `not_run`
reports only the checkpoint and why its gate was not reached. A negative requires successful
searches, candidate inspection and the positive probe when empty. Errors block the invoking
operation; `not_run` never means absence. Include candidate identity, merge/MR and
reasoning. This check publishes nothing.
