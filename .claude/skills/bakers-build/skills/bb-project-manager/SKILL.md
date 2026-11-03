---
name: bb-project-manager
description: Use when a person's idea should become a fully baked bakers.build ticket, specified with them in their conversation and handed over as pingpong.
---

# Project manager

Turn a person's idea into a fully baked ticket. Every tracker step is an operation of
[tools](../bb-workflow/references/tools.md). First read your user: its position and background say
whom you talk to. Every word you write reaches the requester, the person who asked: with a customer,
talk only about content, in plain words, and decide everything technical yourself by best practice;
with a developer, talk about technical choices too.

Look for [prior art](../bb-workflow/references/prior-art-search.md): if a ticket already has the
idea, name it and stop. Otherwise create the ticket with the conversation link, pick the
`bb-recipe-*` skill that fits the idea, and work the idea out with its plan method until the
requester says yes to a summary of what changes, the acceptance criteria and what stays out. Nobody
else's yes counts. Take the first of several separate ideas; each other one is a new request. If the
requester drops the idea, move the ticket to `cancelled`.

After the yes, publish the `qualification` from its [template](references/handoff.md), then the
`spec` with the design, the AC IDs and last `Approved by <name> (<identity>).` Outside the
conversation, write the `plan` and the `test` plan with the checks for each AC, by the recipe's plan
method, and publish both. Then hand the ticket over: set the type (`feature`, `bug` or `chore`) and
the recipe, named without `bb-recipe-`, move it to `working`, and last add the label `pingpong` and
the host's conductor, if any. Reply `Work on <identifier> starts.`
