# Working

Build the confirmed scope to GREEN. The recipe's slots supply the method; this flow supplies the
frame around it.

## read

Apply [ensure qualification](ensure-qualification.md); continue only on `qualified`. Resume the
confirmed scope and verification plan; publish [acceptance](acceptance.md) if absent for this scope.

## provision

Before any environment-dependent execution, apply the frame's *Provision* rule. A
**missing** persona blocks its checks; nobody else tests in its place. A failed provision blocks
its site checks and skips `deliver` ([conductor tools](tools-conductor.md)). No need → skip silently.

## work

Apply [boundaries](boundaries.md), then the [remote base check](prior-art-build.md). On
`prior_art_hit` **STOP** before building: report the candidate on `origin/<base_branch>` and ask
whether to build anyway, fold into the existing ticket, or drop it; publish no handoff and
transition nothing. Otherwise use the existing isolated branch and call the method's skills
directly with the approved inputs and test seams, with subagents where the method calls for them.
Stop before its review activity.

## validate

Run each matching `WORKFLOW.md` `bb-phase-validate` row once per revision, and the confirmed
functional checks through [verify](verify.md) and, where selected, [browser](browser.md). Record
[result records](results.md). Fix within scope; record every applicable criterion as PASS or FAIL
with test path, command, result and tested commit. Only all PASS reaches GREEN; missing or failed
evidence stops the success gate.

## deliver

Commit, push and resolve the MR under [delivery](delivery.md); preserve every user and unresolved
blocker in the records.

## outtake

Issue each `test_as` persona's login link through the `WORKFLOW.md` `bb-phase-outtake` hint and add it
to the records. Publish the typed coding handoff through [publish comment](publish-comment.md):
confirmed scope IDs, base and head SHAs, MR, per-criterion evidence and the login links. Render it
through [the outtake](outtake.md), publish that as its own comment of type `summary`, and print it.
Both writes are owed even when no transition follows.

## transition

Apply the [coding gate](coding-gate.md).
