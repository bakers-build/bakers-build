## Initial context troubleshooting

If `bakers_ticket_read` ([tools](tools.md)) reports that the ticket does not exist or is not readable, say this plainly
before trying another call:

> The ticket read failed — the ticket isn't resolving on the control plane this cwd reaches. Let me
> check config resolution and read WORKFLOW.md.

Then inspect the effective checkout and connection context before retrying:

```bash
git rev-parse --show-toplevel
git worktree list --porcelain
find . .. -path '*/.bakers/bakers.config.js' -type f -print 2>/dev/null
bakers auth status
```

Read the nearest `WORKFLOW.md`, confirm that the ticket belongs to this control plane, and retry the
same call. A failure after that retry is a control-plane/ticket mismatch, not permission to
substitute another ticket or to write anything.

## When the tool is unknown or the endpoint is missing

An unknown tool (exit 4) or an HTTP/protocol error (exit 5) means the connected site serves no
bakers tools at `/mcp`, or the connection points elsewhere. Run `bakers config check --scope
connection` for the global connection or `bakers config check --scope project --path <root>` for a
project override and follow `@bakers-build/bb-upgrade-project`. A read-only ticket request authorizes
diagnosis; apply a configuration repair only within the caller's existing authorization. Report the
selected file and remedy.
