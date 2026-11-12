# Ticket writes

Read before every ticket, comment or relationship write ([tools](tools.md)).

## Content and size

Write for the next reader: only the live thread — what is open, why it matters, what happens next.
Cite earlier comment IDs, AC IDs, MR/commit URLs or artifacts instead of copying their content.
Mark assumptions.

Per line, first fit: not needed by that reader → drop; already recorded → link;
fits one line → one line; otherwise the minimum. Preserve failures, open risks, assumptions,
decisions with reasons and deviations. Put “not checked / risk” in *Problems*.

| Type | Next reader / content | Maximum UTF-8 bytes |
|---|---|---:|
| qualification | plan: sole full AC text, scope, recipe and unresolved assumptions | 4,096 |
| test, debug_diagnose | working: checks per AC ID or confirmed diagnosis | 4,096 |
| spec, plan | working: decisions, implementation and verification steps | 6,144 |
| coding | review: scope IDs, revision, MR, AC results and open risks | 6,144 |
| review | done/working: verdict, findings and required repairs | 6,144 |
| acceptance | verification: AC IDs and references; changed or added criteria only | 3,072 |
| summary | human: outcome, problems and next action | 3,072 |
| retro | human: rating/reason, named causes and their evidence | 3,072 |
| comment and every other type | named reader: the question, decision or new fact | 8,192 |
| ticket description | requester/qualification: problem, wanted behavior and scope | 6,144 |

Evidence: **command, one-line observed result, immutable commit**; failures add the relevant excerpt.
Full logs, transcripts and manifests belong in artifacts.
State formats apply; cite AC IDs outside qualification.

Measure UTF-8 source bytes before writing. Over-budget rejection reports type, bytes and limit;
nothing is saved. Shorten, never split across comments.

## Markdown

Pass Markdown as `body` or `description` (`bb_rich`); raw HTML is stripped. Check formatting.
Type is separate.
Verify ticket text on readback; a comment's create result confirms its publication.

## Publishing a comment

Require caller-authorized ticket, type and readable Markdown body file. Call `bakers_comment_publish`
with its content unchanged, including trailing newlines; no trimming, escaping or re-rendering. An empty or
whitespace-only body means no call. Mutate no other entity as part of publication.

The result confirms publication: return its `id`, without read/search. Report failures with
ticket/type. A timeout or lost response may have stored it: send no second call; report unresolved and reconcile before any retry. A definite budget rejection stored nothing and
permits a shortened retry; a schema rejection (exit 4) permits corrected arguments.

## Validated writes

Validate against the tool schema; correct exit 4 before retrying. Retain UUIDs.
Reconcile uncertain writes by UUID or unique context rather than repeating creates.

Verify state readback. On definite rejection retain state and best-effort restore mapped origin
status while authorized; reconcile uncertainty first. Report unreconciled mismatches.

Type, recipe and labels are term names resolved in the ticket's workspace; verify resolved values
on readback. Links are added, never replaced; preserve existing links.
