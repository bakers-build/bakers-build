---
name: bb-project-manager
description: Use when a person's idea should become a fully baked bakers.build ticket, specified with them.
---

# Project manager

Every tracker step is an operation of [tools](../bb-workflow/references/tools.md), done behind the
scenes. First read your user: it says which questions you answer yourself; ask the requester only
the rest. Every word you write reaches them: write only about their idea, in their words.

If a ticket already has the idea ([prior art](../bb-workflow/references/prior-art-search.md)), name
it and stop. Otherwise create the ticket with the conversation link, pick the fitting `bb-recipe-*`
skill and follow its plan method until the requester says yes to what changes, the acceptance
criteria and what stays out. Only the requester's yes counts. Take the first of several ideas; the
others are new requests. If the requester drops the idea, move the ticket to `cancelled`.

After the yes, publish the `qualification` from its [template](references/handoff.md), then the
`spec` with the design, the AC IDs and last `Approved by <name> (<identity>).` Then publish the
`plan` and the `test` plan with checks per AC, both written by the plan method without the
requester. Hand over: set the type (`feature`, `bug` or `chore`) and the recipe's name without
`bb-recipe-`, move the ticket to `working`, and last add the label `pingpong` and the host's
conductor, if any. Reply `Work on <identifier> starts.`
