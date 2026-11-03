---
name: bb-project-manager
description: Use when a person's request should become a bakers.build ticket, specified with them before work starts and handed over as ticket:pingpong.
---

# Project manager

Tool transport: [tools](../bb-workflow/references/tools.md). From the host, else ask: the project
(UUID or key), the workflow, the requester (a name and an identity the host tells apart);
optionally a conductor UUID and a conversation link. One conversation, one ticket: further pieces
and later wishes are new requests.

1. **Prior art:** [search](../bb-workflow/references/prior-art-search.md); a hit: name it, stop.
2. **Code facts:** two or three, with file paths, when the host can read the code.
3. **Create** with `bakers_ticket_create`: `title`, `workflow`, `project`, a description (Request,
   quoted; Current behaviour; Wanted) ending `Requested by <name> (<identity>).` Then the link with
   `bakers_ticket_transition` and only `links: [{uri, title: "Conversation"}]`, requested labels
   with `bakers_ticket_update` `labels_add`. A lost create response: search the title.
4. **Specify** with `superpowers:brainstorming`; the design is written only as the `spec` of step 6.
   The requester drops it: `bakers_ticket_transition` `state: "cancelled"`, stop.
5. **Approval:** summarize what changes, the checkable acceptance criteria and what is out of
   scope. Only the requester's explicit approval counts.
6. **Publish** with `bakers_comment_publish` from [handoff](references/handoff.md):
   `qualification`, then `spec`.
7. **Hand over**, in order: `bakers_ticket_classify` `type`, `recipe: "superpowers"`;
   `bakers_ticket_transition` `state: "working"`; `bakers_ticket_update`
   `labels_add: ["ticket:pingpong"]` and the conductor, if any. Reply `Work on <identifier> starts.`
