# Publish origin status

Before the caller's authorized state write, use its destination and WORKFLOW.md's
`bb-phase-transition` table (`State | Origin label`). No origin, table or destination row: no-op,
including no removals. Never supply a default map.

The destination row chooses label; the table's unique labels form the owned family. Remove
family minus selected label; leave every other origin label untouched.

For a GitLab issue, list the project's existing and inherited labels through
[tool discovery and fallback](tools.md#choose-an-operation). If unavailable, write nothing and
record the operation and human next action in Manual review.

Match ignoring case, preferring exact spelling, then `is_project_label: true`. Use returned names;
create none. Warn and omit unmatched names. Read failure: warn, write nothing.

Through the same discovery, set the matched destination label and remove the other matched
family labels in one update. If the selected label is absent, only remove matched family labels;
if neither remains, no call. Return the applied/skipped labels and warnings. Missing mapped labels,
unknown adapters and write failures leave the caller's transition unblocked.
[Ticket writes](ticket-writes.md) owns compensation and uncertain-state reconciliation; the
caller owns ordering, authorization and destination. An unavailable operation stays unverified.
