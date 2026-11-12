# Qualification

Qualify the ticket: check prior art, choose the recipe and type, confirm an acceptance-first
handoff, and route once. Execute only qualification, then STOP.

## read

The frame's read is complete ([read ticket](read-ticket.md) › *qualification*: no comment call);
no recipe is set until *work* chooses one.

## provision

none

## work

1. Execute [prior-art search](prior-art-search.md). On a hit, publish nothing, transition nothing;
   report the outcome `prior_art_hit` with identifier, title, state, assignee and available MR/merge, and ask whether to continue,
   combine or close. Close is a [transition](transition-ticket.md) to `cancelled`, never a direct
   `closed` field write. Run the ticket searches, and the probe when a search is empty, before any
   Git call: in sequence, never in parallel.
2. Run the [remote base check](prior-art-build.md). On `prior_art_hit`, apply step 1's stop and
   decision. An `error` also stops publication; its report names the remote branch, every searched
   term and every searched path, and the failing command with its status. Retain the searched terms, the negative
   evidence of both checks and the checked revision for the handoff.
3. Apply [classify](classify.md).
4. Apply [acceptance](acceptance.md) › *Gate each criterion* only: the criteria are published in the
   handoff below, not as a separate `acceptance` comment. Name who tests under
   [result records](results.md) › *Test as*.
5. Apply [agent choice](agent-choice.md).

## validate

none

## deliver

none

## outtake

Publish two comments through [ticket writes](ticket-writes.md), in this order. First, one
complete `qualification` handoff: Outcome, Acceptance, Out of scope, then Handoff metadata.
Acceptance holds stable AC IDs, the gate's passed/rewritten tally, previous wording for rewrites and
explicit assumptions; that tally is not a passed implementation test. Required fields:

- `acceptance_criteria`: exhaustive role-named, checkable conditions; a confirmed intake's criteria
  word for word.
- `out_of_scope`: explicit boundary, including a reasoned none.
- `recipe` and `ticket_type`, with the reason for the recipe choice.
- `reproduction`: bug condition, otherwise `not_required`.
- `scenario_required`: whether confirmed runtime behavior needs a browser path.
- `test_as`: the personas who test and what each should see, or `no login needed`.
- searched terms, and each prior-art check's outcome (`negative`, `prior_art_hit` or `error`) with
  its evidence and the checked revision.
- `handoff_version`: monotonically increasing; requalification supersedes older versions.

Second, render the handoff through [the outtake](outtake.md) and publish that as its own comment of
type `summary`; print it.

## transition

Obtain or reuse approval of the qualification handoff. Publish authorized
[origin status](origin-status.md) for `plan`, then perform one [transition](transition-ticket.md) to
`plan` with its readback. STOP without starting the destination state.
