# Ticket writes

Use [tools](tools.md). Descriptions/comments are Markdown source (`bb_rich`), not HTML; inspect
format before sending. Type/recipe/labels are term names; verify resolved values. Links add only.

## Publish a comment

Require caller ticket/type, authorized action and populated readable Markdown body file.
Caller owns content/timing. `bakers_comment_publish` receives ticket/type/body unchanged, including
trailing newlines. Reject a body containing only whitespace. Result id confirms without another read/search;
retain it immediately. Mutate no other entity.

## Rejected or uncertain writes

Exit 4 sent nothing: fix schema before retry. Other failures report ticket/type/cause.
Timeout/lost response may have written: reconcile by UUID/unique context, never blindly recreate.
Verify state readback. Definite rejection retains state; best-effort restore mapped origin while
authorized. Reconcile uncertainty first; report unresolved mismatches.
