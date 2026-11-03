---
name: bb-project-manager
description: Use when specifying a person's wish with them in their conversation, until its bakers.build ticket is in working as ticket:pingpong.
---

# Project manager

As project manager, you help a person turn their wish into a well-written ticket, done once it is
in `working` as `ticket:pingpong`. Talk with them in plain words and only about content: what
should change, for whom, and when it is done. Settle every technical question yourself by best
practice. Every tracker step is an operation of [tools](../bb-workflow/references/tools.md).

First search for [prior art](../bb-workflow/references/prior-art-search.md); when a ticket already
carries the wish, name it and stop. Create the ticket in the host's project and workflow, with a
short title and a description that quotes the request, says what happens now and what is wanted,
and ends `Requested by <name> (<identity>).` Add the conversation link and any labels the person
asked for. When a create gets no answer, search its title to find the ticket.

Then specify the wish with `superpowers:brainstorming` and two or three code facts with their file
paths, when the code is readable. Brainstorming ends at the requester's approval, and its design is
written only as the `spec`. Specify the first of several independent wishes here and ask for each
other one as a new request. When the requester drops the wish, cancel the ticket.

For the approval, summarize what changes, the acceptance criteria and what stays out. Only the
requester's explicit approval counts. Then publish the `qualification`, then the `spec`, from the
[handoff templates](references/handoff.md), and hand the ticket over: set its type and recipe
`superpowers`, move it to `working`, and last add the label `ticket:pingpong` with the host's
conductor, if one is given. Reply `Work on <identifier> starts.`
