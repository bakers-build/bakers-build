# Ticket writes

Use [tools](tools.md): Markdown (`bb_rich`); verify format and resolved type/recipe/labels.
Reviewers/links: `bakers_ticket_update`; state: transition.

## Content and size

For the next reader: open thread, why, next. Cite comment/AC IDs, MR/commit/artifact; never copy.
Per line: unneeded → drop; recorded → link; fits one line → one line; else minimum.
Keep failures, risks, assumptions, decisions/why, deviations. Mark unverified claims.
Put not checked / risk in *Problems*. State formats apply; full ACs only in qualification.

| Type | Reader: content | UTF-8 bytes |
|---|---|---:|
| qualification | plan: ACs, scope/recipe/assumptions | 4096 |
| test, debug_diagnose | working: AC checks/diagnosis | 4096 |
| spec, plan | working: decisions/steps/checks | 6144 |
| coding | review: scope IDs, SHA/MR, AC results/risks | 6144 |
| review | done/working: verdict/findings/repairs | 6144 |
| acceptance | verification: AC refs, additions/changes | 3072 |
| summary | human: outcome/problems/next | 3072 |
| retro | human: rating/reason/causes/evidence | 3072 |
| comment/other | named reader: question/decision/fact | 8192 |
| description | requester/qualification: problem/want/scope | 6144 |

Evidence: **command, one-line observation, immutable commit**; failures add excerpt.
Logs/transcripts/manifests stay in artifacts. Measure before writing. Oversize: type/bytes/limit, nothing saved; shorten, never split.

## Publish a comment

Require authorized ticket/type and readable populated body file. Send unchanged to
`bakers_comment_publish`, trailing newlines included. Whitespace-only: no call.
Result id confirms: retain/return, no read/search or other mutation.

## Rejected or uncertain writes

Budget rejection saved nothing: shorten/retry. Exit 4: fix schema/retry. Report other failures
with ticket/type/cause. Timeout/lost response: no second call; reconcile by UUID/unique context.
Verify state readback; rejection keeps state, best-effort restores mapped origin while authorized.
Reconcile uncertainty first; report mismatches.
