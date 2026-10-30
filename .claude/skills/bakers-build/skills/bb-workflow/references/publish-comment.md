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
(exit 4) permits correction. Mutate no other entity.
