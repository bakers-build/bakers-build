# Ticket writes

Read before writing a ticket, comment or relationship. Every write is a tool call
([tools](tools.md)).

## Handoffs and ticket text are Markdown

Pass Markdown source as a comment's `body` or a ticket's `description`; the tool stores it as
`bb_rich`. Inspect headings, lists, links and tables before writing. Raw HTML is stripped. The
comment type is its own argument, separate from the text. Verify the exact stored text on readback;
[publish comment](publish-comment.md) confirms comments by their result.

## Validated writes and uncertain outcomes

Arguments are validated against the tool's schema before sending; correct a rejection (exit 4)
before retrying. Retain returned UUIDs immediately. Reconcile uncertain writes by UUID or uniquely
matching context; never blindly repeat a create.

Verify state readback. On definite rejection retain state and best-effort restore mapped origin
status while authorized; on uncertain outcomes reconcile first. Report unreconciled mismatches.

## References are named, not resolved

Type, recipe and labels are term names; the tool resolves them in the ticket's workspace. Verify the
resolved values on readback. Links are added, never replaced: the tool keeps existing links.
