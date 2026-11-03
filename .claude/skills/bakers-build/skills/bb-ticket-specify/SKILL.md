---
name: bb-ticket-specify
description: Use when a person brings a request for a bakers.build ticket to be specified with them before work starts; hands it over as ticket:pingpong.
---

# Specify a ticket with its requester

Tool transport: [tools](../bb-workflow/references/tools.md). From the host, else ask: the project
(UUID or key), the workflow and the requester (a name and an identity the host tells apart; in a
one-person conversation, the person present); optionally a conductor UUID and a conversation link.
One conversation carries one ticket.

1. **Prior art:** [search](../bb-workflow/references/prior-art-search.md). A hit: name it. Stop.
2. **Code facts:** when the host can read the project's code, two or three facts with file paths.
3. **Create** with `bakers_ticket_create`: `title`, `workflow`, `project` and a description
   (Request, quoted; Current behaviour; Wanted) ending `Requested by <name> (<identity>).` Then
   `bakers_ticket_transition` with only `links: [{uri, title: "Conversation"}]` when there is a
   link, and `bakers_ticket_update` `labels_add` for labels the requester asked for. After a lost
   create response, search the title first.
4. **Specify** through `superpowers:brainstorming`; the design lands on the ticket at step 6
   instead of a file. Several independent pieces: specify the first; each other one is a new
   request. The requester drops it:
   `bakers_ticket_transition` `state: "cancelled"`. Stop.
5. **Approval:** show what changes, the checkable acceptance criteria and what is out of scope.
   Only the requester's explicit approval counts; anyone else's leaves the ticket as it is.
6. **Publish** with `bakers_comment_publish`, filled from [handoff](references/handoff.md):
   `qualification`, then `spec`.
7. **Hand over**, in order: `bakers_ticket_classify` with `type` and `recipe: "superpowers"`;
   `bakers_ticket_transition` `state: "working"`; `bakers_ticket_update` with
   `labels_add: ["ticket:pingpong"]` and the conductor, if any. Reply with the one line
   `Work on <identifier> starts.` A later wish is a new request.
