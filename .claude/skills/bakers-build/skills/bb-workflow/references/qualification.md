# Qualification

## references

Read in order at the consuming step; skip unmet conditions.

always: read-ticket.md, tools.md, qualification.md
if ticket read fails: read-ticket-troubleshooting.md
if needed comments missing: comment-context.md
always: prior-art-search.md
if paginated lookups or agent overrides need resolution: tools.md
always: prior-art-build.md, forge.md
if forge tools absent: forge-fallback.md
if asking for cancellation confirmation: retrospective.md
if cancellation reason supplied: retrospective-write.md
always: classify.md, ticket-writes.md, acceptance.md, results.md, agent-choice.md, outtake.md, outtake/qualification.md, evidence.md, transition-ticket.md
if ticket has an origin: origin-status.md

## read

Frame context is complete; qualification makes no comment call. Recipe waits for classification.

## provision

none

## work

1. [Prior-art search](prior-art-search.md): run ticket searches/probes before any Git call,
   sequentially. On hit publish/transition nothing: report prior_art_hit, identifier/title/state/
   assignee/MR or merge; ask continue/combine/close. Close uses [transition](transition-ticket.md)
   to cancelled, never closed field.
2. [Remote base check](prior-art-build.md): same hit stop. Error stops publication with remote,
   terms/paths and failing command/status. Retain both negative checks and checked revision.
3. [Classify](classify.md).
4. [Acceptance](acceptance.md) › Gate each criterion, published in handoff, not separate acceptance.
   Name [test personas](results.md).
5. [Agent choice](agent-choice.md).

## validate

none

## deliver

none

## outtake

Via [ticket writes](ticket-writes.md) publish qualification: Outcome, Acceptance, Out of scope,
Handoff metadata. Include stable exhaustive AC IDs, role-named checkable conditions (confirmed
seed word for word), wording tally, previous rewrites/assumptions. The tally rates wording, not implementation.
Metadata: acceptance_criteria; out_of_scope (explain if none); recipe/type/method reason;
reproduction (bug condition else not_required); scenario_required (runtime browser path);
test_as (personas/expected views or no login needed); searched terms, each prior-art outcome/
evidence/SHA; monotonically increasing handoff_version superseding older ones.
Then render [outtake](outtake.md), publish separate summary and print.

## transition

Obtain/reuse handoff approval; authorized [origin status](origin-status.md) to plan if origin;
[transition](transition-ticket.md) once to plan with readback. STOP before destination work.
