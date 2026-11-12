# Publish origin status

Before the caller's authorized state write, use its destination and WORKFLOW.md's
`bb-phase-transition` table (`State | Origin label`). No origin, table or destination row: no-op,
including no removals. Never supply a default map.

The destination row chooses label; the table's unique labels form the owned family. Remove
family minus selected label; leave every other origin label untouched.

For GitLab `https://<host>/<path>/-/issues/<n>`, URL-encode the project path and fetch existing
project/inherited labels:

```bash
glab api --hostname "<host>" --paginate "projects/<encoded path>/labels?include_ancestor_groups=true&per_page=100"
```

Match ignoring case, preferring exact spelling, then `is_project_label: true`. Use returned names;
create none. Warn and omit unmatched names. Read failure: warn, write nothing.

```bash
glab issue update "$origin" --label "$label" --unlabel "$remove"
```

Pass comma-separated remove; mapped labels cannot contain commas. If selected label is absent,
pass only --unlabel; if neither remains, no call. Return success. Unknown adapters/write failures warn, leaving ticket work unblocked. [Ticket writes](ticket-writes.md) owns compensation and
uncertain-state reconciliation; the caller owns ordering, authorization and destination.
