---
name: bb-ticket-answer
description: Use when a person answers or asks about a bakers.build ticket's open question or technical problem; passes the answer back to the ticket.
---

# Answer a ticket's question

A run that needs a person asks on its ticket, labels it `Question` and freezes it; the answer
unfreezes it. Tool transport: [tools](../bb-workflow/references/tools.md).

From the host, else ask: the ticket (identifier or UUID) and who speaks (a name and an identity
the host tells apart; in a one-person conversation, the person present). Anyone may answer, a
merge approval included.

1. **Read** the ticket with `bakers_ticket_read`.
2. **Technical problem** (label `technical problem`, with or without `Question`): show its note,
   the newest comment that is not a `summary`, and say keytec solves it. Stop.
3. **Settled** (not frozen, or no `Question` label): say so in one line. Stop.
4. **The question** is the newest comment starting `# Question`; show it when asked. Ask back
   until one clear answer stands that contradicts no earlier answer on the ticket.
5. **Merge question:** an approval passes on only when the question names `next` as the target;
   otherwise say that only a merge into `next` can be approved here. Stop.
6. **Pass on**, in order: `bakers_comment_publish` with `type: "comment"` and a body starting
   `Answered by <name> (<identity>):` plus the answer in the answerer's words; then
   `bakers_ticket_update` with `labels_remove: ["Question"]` and `frozen: false`.
7. **Reply** in one line: the answer reached the ticket.
