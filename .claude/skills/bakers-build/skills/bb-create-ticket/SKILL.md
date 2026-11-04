---
name: bb-create-ticket
description: Use when a person's idea or an intake should become a bakers.build ticket, specified with them when asked, or to resume an interrupted creation.
---

# Create a ticket

First read your user: it says whether to specify and which questions you answer yourself; ask the
requester only the rest. Every tracker step is an operation of
[tools](../bb-workflow/references/tools.md).

The host may add a conversation link, a conductor and the wish to specify. In a checkout, an
explicit parent wins, else propose the branch's ticket; the intake's conductor is the host's,
set after any route; apply [agent choice](../bb-workflow/references/agent-choice.md) and, before each
route, [origin status](../bb-workflow/references/origin-status.md). An existing ticket is read, never
replaced.

## Create

First run the [prior-art search](../bb-workflow/references/prior-art-search.md),
proving each empty search; on a hit, name it and stop for a decision. Create the ticket with the
verbatim title and Markdown description, with recipe and type once
[classify](../bb-workflow/references/classify.md) decides them; read it back, then add the
conversation link.

## Specify

Only when your user or the request says to specify. Then the tracker work stays silent, behind the
scenes: every word you write reaches the requester, so write only their idea, in their words,
never the tracker or your steps. Until a route, each reply starts with your first question.

Follow the plan method of the fitting `bb-recipe-*` skill, with facts from the project's code,
until the requester says yes to what changes, the acceptance criteria and what stays out. One idea
per ticket. A dropped idea moves the ticket to `cancelled`.

## Publish and route

Approval is the requester's yes or an intake's confirmation, never someone else's. Then publish the
`qualification` as [qualification](../bb-workflow/references/qualification.md) › *outtake* lists,
and:

1. **Hand-over**, after the requester's yes on a `feature` or `chore`: the `spec` (design, AC IDs,
   last `Approved by <name> (<identity>).`), then the `plan` and `test` with checks per AC,
   both by the plan method without the requester; the `summary`; only then set
   type and the recipe's name without `bb-recipe-`; move to `working`; last set the host's
   conductor, or ask the requester which of the project's conductors runs it, whatever your
   user says.
2. **A confirmed intake with `spec`, `plan` and `test`:** publish them, the `summary`, then move to
   `working`.
3. **Otherwise**, a bug included: set type and recipe if still open, publish the `summary`, then
   move to `plan`.

Each `summary` follows the [outtake](../bb-workflow/references/outtake.md). Route once every comment
is confirmed; read it back. A measurement baseline follows
[baseline](references/baseline.md).

Once routed, reply in one line. After specifying: `Work on <identifier> starts.` once the
conductor is set, else the conductor question, for a bug `<identifier> is recorded.` and that its
diagnosis comes next. For an intake: the identifier and its state.
