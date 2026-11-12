# Delivery

Use [forge operations](forge.md) for fetch, push, MR, checks and merge. For GitHub also read
[GitHub delivery](github-delivery.md).

Commit scoped work under project conventions, push and create/update its MR. Immediately persist
its verified URL through [transition ticket](transition-ticket.md)'s links-only write before
coding handoff, even if remaining in working. Resolve applicable checks before claiming GREEN.

The derived target is target_branch (else base_branch); variants target the ticket branch.
Feature branches squash into one commit. [Merge](merge.md) owns the squash body's ticket trailer.
MR title/description carry no bakers.build reference. Send method and source deletion explicitly:
delete only the ticket's own short-lived branch, never shared/environment branches, promotion
branches reused later, or sources other open MRs target. Forge tools enforce these properties;
client defaults and project settings do not decide them.

At review supply confirmed scope, pinned base/head diff and recorded evidence to the review method.
Reuse valid evidence; rerun only for changes, failures, unresolved concerns or user request.
Record added evidence and the independent verdict in the ticket; no repository spec file is needed.
