# Publish a comment

Read before publishing any comment; the caller is the state file's phase.

**Every comment type uses Markdown source, never HTML.** Before any create or update, apply
[ticket writes](ticket-writes.md). This includes caller-supplied
bodies, summaries and full technical handoffs; `bb_rich` does not convert HTML into Markdown.

Require the caller's explicit ticket, comment type, readable populated Markdown body file, and
action authorization. The caller owns content, type and timing.

Call `bakers_comment_publish` ([tools](tools.md)) with `ticket`, `type` (the comment type) and
`body`, the file's content unchanged: every trailing newline, no trimming, escaping or
re-rendering. An empty or whitespace-only body is no comment; stop before the call.

The result is the confirmation: return its `id`, with no read or search. Any other outcome is a
concrete failure; report it with the ticket and type. A timeout or lost response may still have
created the comment, so send no second call; report it as unresolved. A rejection before sending
(exit 4) permits correction. Mutate no other entity; a question below is the one exception.

## A question for a human

A **question** is a decision the ticket, its comments, the repository and the confirmed scope
cannot settle. Gate decisions (plan or verdict approval, merge authorization, a prior-art hit, the
coding gate) keep their own flows. Ask a question on the ticket:

1. Publish one comment of type `comment` whose body is `# Question`, then the question with its
   context, then the choices as a numbered list with the recommended one marked, then the line
   "Answer in a comment, then remove the label *Question* and unfreeze the ticket."
2. Call `bakers_ticket_update` with `ticket`, `labels_add: ["Question"]` and `frozen: true`. Check
   that the result lists `Question` in `labels` and `frozen: true`.
3. End the run: print the question and its comment id, with no summary, no transition and no state
   change.

A failed or uncertain update stops the run as blocked; the published comment stands as the only
question comment.
