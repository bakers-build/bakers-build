---
name: bb-create-ticket
description: Use when a person's idea or an intake should become a bakers.build ticket, specified with them when asked, or to resume an interrupted creation.
---

First read your user: its profile decides whether to specify and which questions you answer; ask
the requester only the rest. When you specify, every word reaches the requester: only their idea,
in their words, never the tracker or your steps; each reply opens with your next question. The host
may add a conversation link, a conductor and the wish to specify.

Checkout: an explicit parent wins, otherwise propose the branch's ticket; the intake's conductor
counts as the host's; apply [agent choice](../bb-workflow/references/agent-choice.md) and
[origin status](../bb-workflow/references/origin-status.md) before routing.

1. **Create:** [search prior art](../bb-workflow/references/prior-art-search.md), every spelling, and
   prove each empty search with the probe before you judge a hit; on a hit, name it and stop for a
   decision. Create with the verbatim title and Markdown description and the intake's recipe, type
   and parent; read it back; add the conversation link. Read existing tickets; never replace them.
2. **Specify** only when the profile or the request says so: use the fitting `bb-recipe-*` plan
   method with facts from the project's code. Only the requester's yes counts, never someone
   else's. One idea per ticket.
3. **Publish** the `qualification` with the fields of
   [qualification › outtake](../bb-workflow/references/qualification.md#outtake). After specifying a
   `feature` or `chore`, add the `spec`, `plan` and `test` of
   [plan › deliver](../bb-workflow/references/plan.md#deliver): the `spec` closes with
   `Approved by <name> (<identity>).`, the `test` names AC IDs. Publish the `summary` last.
4. **Route** once the comments are confirmed. A specified `feature` or `chore`: set type and recipe
   (the name without `bb-recipe-`), move to `working`, last set the host's conductor, or ask the
   requester which of the project's conductors runs it, whatever your user says. A confirmed intake
   with `spec`, `plan` and `test`: `working`. Otherwise, a bug included: set type and recipe if
   still unset, then `plan`. Read it back.

Reply in one line: the conductor question while it is open; after `working` with a conductor,
`Work on <identifier> starts.`; for an intake, the identifier and its state; for a bug,
`<identifier> is recorded.` and that its diagnosis comes next.
