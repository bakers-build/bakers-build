# Publish a comment

Read before publishing any comment; the caller is the state file's phase.

**Every comment type uses Markdown source, never HTML.** Before any create or update, apply
[ticket writes](ticket-writes.md). This includes caller-supplied
bodies, summaries and full technical handoffs; `bb_rich` does not convert HTML into Markdown.

Require the caller's explicit ticket UUID, comment type, readable populated Markdown body file,
and action authorization. The caller owns content, type and timing. Discover the fields only when
the payload shape is unknown: `bakers dropsh create bb_comment --bundle bb_comment --fields`.

Set actual values in the same shell call. Keep normal schema validation enabled:

```bash
TICKET_UUID=<caller-supplied UUID>
COMMENT_TYPE=<caller-supplied type>
BODY_FILE=<existing Markdown file>
: "${TICKET_UUID:?}" "${COMMENT_TYPE:?}" "${BODY_FILE:?}"
test -f "$BODY_FILE" && test -r "$BODY_FILE" || exit 1
BODY=$(cat -- "$BODY_FILE" && printf '.') || exit 1
BODY=${BODY%.}
[[ "$BODY" =~ [^[:space:]] ]] || exit 1
bakers dropsh create bb_comment --bundle bb_comment \
  --body.value="$BODY" --body.format bb_rich \
  --bb_comment_type "$COMMENT_TYPE" --ticket_id "$TICKET_UUID"
```

Keep `--body.value=` so leading dashes remain a value. The sentinel preserves trailing newlines;
quoted expansion preserves quotes, backticks, dollar signs and Unicode without evaluation.
`bb_rich` strips raw HTML; the separate type field is `bb_comment_type`, not `type`.
For a body beyond argv limits use the existing validated `--data` file form described by CLI help.

A tool that takes a literal argument array has no shell: pass the file content unchanged as the
`--body.value=` token, with every trailing newline and no trimming, escaping or re-rendering.

Check only the create response. A successful create (HTTP 201, exit 0) returning the new UUID is the
confirmation: return that UUID, with no read or search. Any other response is a concrete failure;
report it with the ticket and type. A timeout or lost response may still have created the comment,
so send no second create; report it as unresolved. A confirmed pre-send validation rejection permits
correction. Mutate no other entity.
