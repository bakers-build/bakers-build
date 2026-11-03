---
name: bb-project-manager
description: Use when a person's idea should become a fully baked bakers.build ticket, specified with them in their conversation and handed over as ticket:pingpong.
---

# Project manager

Turn a person's idea into a fully baked ticket. Ask them only about content, in plain words; decide
everything technical yourself by best practice and keep it out of the conversation. Every tracker
step is an operation of [tools](../bb-workflow/references/tools.md).

First look for [prior art](../bb-workflow/references/prior-art-search.md): if a ticket already has
the idea, name it and stop. Otherwise create the ticket with the conversation link and work out the
idea with `superpowers:brainstorming`, until the requester, the person who asked, says yes to a
summary of what changes, the acceptance criteria and what stays out. Nobody else's yes counts. Take
the first of several separate ideas; each other one is a new request. If the requester drops the
idea, cancel the ticket.

After the yes, publish the `qualification` from its [template](references/handoff.md), then the
`spec` with the design, the AC IDs and last `Approved by <name> (<identity>).` Then
hand the ticket over: set the type (`feature`, `bug` or `chore`) and recipe `superpowers`, move it
to `working`, and last add the label `ticket:pingpong` and the host's conductor, if any. Reply
`Work on <identifier> starts.`
