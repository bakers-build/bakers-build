---
name: bb-create-ticket
description: Use when a person's idea or an intake should become a bakers.build ticket, specified with them when asked, or to resume an interrupted creation.
---

# Create a ticket

First read your user: it says whether to specify and which questions you answer yourself; ask the
requester only the rest. Every tracker step is an operation of
[tools](../bb-workflow/references/tools.md).

The host supplies the project, the workflow and the requester: a name and a distinct identity. It
may add a conversation link, a conductor and the wish to specify. In a checkout, apply
[checkout](references/checkout.md). An existing or resumed ticket is read, never replaced.

## Create

Before any write, run the [prior-art search](../bb-workflow/references/prior-art-search.md),
proving each empty search; on a hit, name it and stop for a decision. Create the ticket with the
verbatim title, Markdown description, project and workflow, with recipe and type once
[classify](../bb-workflow/references/classify.md) decides them, then add the conversation link. Read
it back.

## Specify

Only when your user or the request says to specify. Then the tracker work stays silent, behind the
scenes: every word you write reaches the requester, so write only their idea, in their words,
never the tracker or your steps. Until a route, each reply starts with your first question.

Pick the fitting `bb-recipe-*` skill and follow its plan method, with facts from the project's code,
until the requester says yes to what changes, the acceptance criteria and what stays out. One idea
per ticket. A dropped idea moves the ticket to `cancelled`.

## Publish and route

Approval is the requester's yes or an intake's confirmation, never someone else's. Then publish the
`qualification` from its [template](references/handoff.md), and:

1. **Hand-over**, after the requester's yes on a `feature` or `chore`: the `spec` (the design, the
   AC IDs, last `Approved by <name> (<identity>).`), then the `plan` and the `test` plan with checks
   per AC, both by the plan method without the requester; the `summary`; only then set the
   type and the recipe's name without `bb-recipe-`; move to `working`; last add the label `pingpong`
   and the host's conductor, if any.
2. **A confirmed intake with `spec`, `plan` and `test`:** publish them, the `summary`, then move to
   `working`.
3. **Otherwise**, a bug included: set type and recipe if still open, publish the `summary`, then
   move to `plan`.

Each `summary` follows the [outtake](../bb-workflow/references/outtake.md). Route once every comment
is confirmed; read back. A measurement baseline follows [baseline](references/baseline.md).

Once routed, reply in one line. After specifying: `Work on <identifier> starts.` after a hand-over
with a conductor, `<identifier> is ready for work.` without one, for a bug `<identifier> is
recorded.` and that its diagnosis comes next. For an intake: the identifier and the state it moved
to.
