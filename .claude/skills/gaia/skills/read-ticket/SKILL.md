---
name: read-ticket
description: Load complete ticket context on state entry; reuse complete current-step context until a freshness trigger.
---

# Read a ticket

On entry to each new state run, resolve the explicit ticket identifier to its UUID and run:

```bash
gaia dropsh --format md read gaia_ticket/gaia_ticket/<ticket-uuid> --include comments,labels
```

Use the actual UUID; `--format` belongs before `read`. Resolve `work:*` and `method:*` label
names from included terms. Verify every referenced comment and label is included, then read all
comment bodies in chronology. A loaded empty `comments` relationship is valid; an absent include,
missing referenced body, or truncated output is incomplete context and must be recovered.

Retain UUID/revision, relationship membership, resolved labels, ordered comment IDs/types/bodies,
qualification, explicitly confirmed spec/plan/test IDs and later amendments. A helper in the same
uninterrupted step consumes this complete context instead of repeating a full read. Append our own
verified writes to it. A later proposal does not replace confirmed IDs; adjudicate later user
constraints even when content hashes match.

Refresh on a new run, compaction losing required bodies, uncertain write, known concurrent/user
amendment, or changed server revision unexplained by our verified writes. Check freshness before
read-modify-write or authorization-sensitive mutation. A supported narrow metadata read may prove
freshness only when the retained context was complete; when uncertain reload all context.

On HTTP 404 or a missing Markdown renderer, read [troubleshooting](references/troubleshooting.md)
before retrying or switching format. Preserve selected connection/path and report any raw JSON:API
fallback. Return complete context; `@gaia/run-intake` renders the caller's plan. Choose no work or
state and perform no mutation.
