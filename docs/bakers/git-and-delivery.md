# Git and delivery

Repository-internal conventions for the bakers.build repository. `CLAUDE.md` points here;
`@bakers-build/bb-workflow` applies these rules operationally (`references/delivery.md`,
`references/merge.md`).

## Commit messages

A commit message has three parts:

    <type>(<origin-ref>): <short imperative subject>

    <optional body, wrapped, explaining *why*>

    ref:<identifier>

`<type>` is a conventional-commit type (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, …)
chosen for what the commit does. `<origin-ref>` names the **origin** ticket in the origin
platform's own notation — for GitLab `<project>#<issueID>` (`bakers#123`), derived from the
ticket's `origin` URL `<base>/<project-path>/-/issues/<iid>`: the last segment of
`<project-path>` plus `#` plus the issue id. The full namespace path (`bakers-build/bakers-build#123`) is
used **only** where it is needed to disambiguate. A ticket with **no origin issue omits the
scope entirely** (`chore: <subject>`) — the bakers.build identifier is deliberately not substituted
into it, because it is already in the trailer. The body is optional and stays proportional:
enough to explain *why*, not a transcript. **`ref:<identifier>` is always the very last line**,
where `<identifier>` is the value of the ticket's own `identifier` field, copied verbatim in its
canonical casing — never a literal prefix plus a number. That field is `<project key>-<number>`,
so a ticket whose `identifier` is `SHOP-42` gets `ref:SHOP-42`, and one whose `identifier` is
`BB-392` gets `ref:BB-392`; on this project the two coincide, which is exactly why the
distinction has to be stated. The trailer matters because it is what `bakers deployment tickets`
parses out of the merged commit delta to compute a release batch — a commit with no ticket
identifier is invisible to it, and silently so. The parse admits any project key rather than
`bakers.build` alone: an identifier has the shape a project key plus a number (`SHOP-42`), and a key
counts as admitted once it has appeared in an anchored position — the `ref:` trailer, a
conventional-commit scope (`feat(BB-134):`), or a subject-leading `BB-375:` — after which
bare occurrences of that same key are matched too. That parse reads the **whole** delta, so a
body citing another ticket's identifier pulls that ticket into the batch: cite neighbouring work
by branch or commit, not by its ticket number.

## GitHub pull requests

GitHub's default branch is `next`; `main` is stable. Open the PR from `<branch_name>` into the
ticket's computed `<base_branch>` through the forge tools (`bb-workflow` ›
`references/forge.md`). Feature PRs squash-merge with the title
as subject and final-line `ref:<identifier>` in the body. GitHub has no per-PR squash/deletion
preferences: send the merge method explicitly and delete only an eligible short-lived source
branch after verified success. Preserve shared branches and branches targeted by other PRs.

Only this repository's `next` promotes into `main`, by merge commit preserving the candidate
tree and second parent. Keep both branches. The frozen second parent identifies the release.
The GitLab-specific client instructions below apply only to repositories still hosted there.

## GitLab merge requests

a merge request title and description carry **no bakers.build reference**,
without exception: the MR is the customer-facing artifact and the bakers.build identifier belongs in
the commit trailer only. Work lands through a merge request, squash-merged, targeting the
ticket's computed **`base_branch`** — the direct parent's branch for a sub-ticket, otherwise the
project's default branch, which for the legacy GitLab repository is `develop`. The forge tools
derive that target from the run; without them the coding step passes it explicitly
(`glab mr create --target-branch <base_branch>`), because left implicit glab targets the
repository default and a sub-ticket lands beside its parent's work instead of on top of it.
Because a squash collapses the branch's commits into one message — discarding their trailers —
`bb-workflow` › `references/merge.md` writes `ref:<identifier>` into the squash commit's body
itself, the commit that represents the change; left to GitLab's default template it would carry
only the MR title, which by the rule above carries no reference at all. How that merge request is **opened** is
equally not left to the client: it targets the ticket's `base_branch` as above and carries
**squash commits** and **delete source branch** both enabled — the deletion only because the
source is the ticket's own short-lived work branch, never for a long-lived or shared branch, a
release branch a later promote reuses, or a branch other open MRs still target as their base.
`bb-workflow` › `references/delivery.md` and `references/merge.md` own that rule operationally, and the forge tools
send each property explicitly, because none of them is a value a client supplies on its own: `squash` and `remove_source_branch` are written onto the MR when it is created, and a
merge call that omits `squash` or `should_remove_source_branch` inherits whatever the MR already
stores — including the `force_remove_source_branch` a forge project setting puts there — so a
property left unstated is decided somewhere else entirely.

`main` is the exception: it is never squashed. Only a release branch reaches it, by merge commit,
so the `release` job tags the merge's second parent, the frozen `develop` commit, which `develop`
contains ([deployment](../addons/deployment/reference.md)).

## Ticket identifiers by surface

The bakers.build identifier is a pointer into the tracker, and where
it may appear is decided per surface rather than per author.
- **bakers.build skill prose carries none.** No `SKILL.md`, reference, template or README under
  `.claude/skills/bakers-build/**` cites a ticket identifier. A skill is an instruction to an agent, not
  a changelog: the reader who has to follow the rule does not need its archaeology, and the
  identifier ages into a reference to a tracker that reader may not be able to query. A rule that
  reads as arbitrary without its ticket number is a rule whose reason was never written down —
  write the reason, in the sentence, and the number buys nothing.
- **An identifier used as an example value is not a citation** and is unaffected: `ref:SHOP-42`
  illustrating the trailer's shape, or `BB-392` illustrating what the `identifier` field holds,
  names no ticket in the sense this rule forbids. Neither does a path whose directory is a ticket.
- **Code comments may carry one.** A comment sits beside the code it explains, is read by whoever
  changes that code, and dies with it; the pointer is cheap there and the archaeology is the point.
- **New tests follow `bb-workflow/references/evidence.md` › *Durable evidence and the transient root*.**
  Existing ticket-named tests and contract scripts remain a legacy exception because the
  *Checks* table depends on them; they are no precedent for new committed tests.
- **Artefacts whose identity is a ticket are named, not citing** — `docs/specs/`, the transient
  root `assets-ai/<identifier>/`. Existing ticket-named contract scripts follow the legacy
  exception above.
- **No gate enforces this, deliberately.** The rule has three definitional non-citations — an
  example value, a path, a ticket-named artefact — that a grep cannot tell from a citation, so a
  gate would need a maintained exception list, and an exception list is where the next citation
  takes up residence. Enforcement is review care, and this sentence is the judgement rather than
  an omission.
