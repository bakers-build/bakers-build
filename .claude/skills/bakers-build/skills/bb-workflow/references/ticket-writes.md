# Ticket writes

Read before writing a ticket, comment or relationship.

## Handoffs and ticket text are Markdown

Store Markdown source in `body.value` or a ticket's `description.value` with `format: bb_rich`.
Inspect headings, lists, links and tables before writing. Raw HTML is stripped. `bb_comment_type`
is separate from the text format. Verify exact stored text and format on readback;
`@bakers-build/bb-publish-comment` confirms comments by their create response.

## Validated writes and uncertain outcomes

Keep outgoing schema validation enabled. Discover writable fields with `--fields`; use
body file → field parameters → live. Use supported data-file input for bodies exceeding argv limits.
Retain created UUIDs immediately. Reconcile uncertain writes by UUID or uniquely matching context;
never blindly repeat the create. Correct confirmed pre-send rejection before retrying.

Verify state readback. On definite rejection retain state and best-effort restore mapped origin
status while authorized; on uncertain outcomes reconcile first. Report unreconciled mismatches.

## References are named, not resolved

Use schema-supported name flags. Environment names require project scope. Verify resolved
relationships, not input-only flags. PATCH replaces relationships; preserve existing members.
Clear nullable references only through supported normal validation.

