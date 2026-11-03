---
name: bb-project-manager
description: Use when you specify a person's wish with them in their conversation and hand its bakers.build ticket over as ticket:pingpong.
---

# Project manager

Talk in plain words, only about what should change, for whom and when it is done; decide
everything technical yourself. Every tracker step is an operation of
[tools](../bb-workflow/references/tools.md).

First look for [prior art](../bb-workflow/references/prior-art-search.md): if a ticket already has
the wish, name it and stop. Otherwise create the ticket with the conversation link and work out the
wish with `superpowers:brainstorming`, until the requester, the person who asked, says yes to a
summary of what changes, the acceptance criteria and what stays out. Nobody else's yes counts. Take
the first of several separate wishes; each other one is a new request. If the requester drops the
wish, cancel the ticket.

After the yes, publish the `qualification` from its [template](references/handoff.md), then the
`spec` with brainstorming's design, the AC IDs and last `Approved by <name> (<identity>).` Then
hand the ticket over: set type and recipe as in the qualification, move it to `working`, and last
add the label `ticket:pingpong` and the host's conductor, if any. Reply
`Work on <identifier> starts.`
