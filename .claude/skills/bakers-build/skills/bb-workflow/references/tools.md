# Call a bakers tool

The site serves tracker operations at `/mcp`.

## Transport

- **Listed** as `<tool>` (`bakers` server) or `tool_api__<tool>` (site connector): call it.
- **Not listed yet**: load it with the host's tool search, which waits for a connecting server
  (Claude Code: `ToolSearch` `select:mcp__bakers__<tool>`).
- **Not loadable**: `bakers tools <tool> --data @<args.json>`, with your credentials, or the run
  token in a [conductor](tools-conductor.md) run. There, a denied call means the tool is not loaded yet:
  load it and retry over MCP; the denial covers that command only.

A CLI call runs alone, with literal values; chaining sandboxes it. Write its JSON file exactly
with a JSON encoder
(`jq -n --rawfile body <file.md> --arg t <ticket> '{ticket: $t, type: "plan", body: $body}'`).

## Results and errors

| Exit | Meaning | Next |
|---|---|---|
| 0 | success; JSON result on stdout | use the result |
| 1 | the tool refused; the message names the cause | report it; correct only arguments the message shows wrong |
| 3 | credentials rejected | `bakers auth status` outside a run; report |
| 4 | invalid arguments or unknown tool, nothing sent | fix the arguments against `bakers tools <tool> --schema` |
| 5 | HTTP or protocol error | report |

**An error is not a negative**: a failed read or search found nothing out. A timed-out or exit-5 write
may have happened: reconcile with a read, never resend it.

## Operations

`ticket` is an identifier (`<KEY>-<number>`) or UUID; outside comments, `type`, `recipe` and `label`
are term names, reused or created.

| Operation | Tool | Arguments | Result |
|---|---|---|---|
| Read a ticket | `bakers_ticket_read` | `ticket` | the ticket's fields, `branch_name`, `base_branch`, `conductor`, `frozen`, `comments` (`id`, `type`, `body`, `created`, `author`; oldest first) |
| Search tickets | `bakers_ticket_search` | `query` (title or description) or exact `branch_name`; optional `project` | `tickets` (`identifier`, `title`, `state`, `branch_name`); newest first, at most 50 |
| Create a ticket | `bakers_ticket_create` | `title`, `workflow`, `project` (key or UUID); optional `description`, `type`, `recipe`, `parent`, `branch_name`, `assignee_email`, `reviewer_emails` | `id`, `identifier`, `state`, `branch_name`, `assignee`, `reviewers`, `url` |
| Edit a ticket | `bakers_ticket_update` | `ticket`; any of `title`, `description`, `conductor` (UUID), `labels_add`, `labels_remove` (absent ignored), `frozen`, `environments_add` (names, UUIDs), `referenced_tickets_add` (adds only) | saved values; others kept; a label in both lists refused; closed: refused |
| Set recipe and type | `bakers_ticket_classify` | `ticket`; `recipe`, `type` or both | saved `recipe` and `type` |
| Change state or add links | `bakers_ticket_transition` | `ticket`; `state`, `links` (`[{uri, title}]`) or both | saved `state` and all `links`; existing links kept, no duplicate `uri`; no `state` keeps it |
| Publish a comment | `bakers_comment_publish` | `ticket`, `type`, `body` | new comment `id`, stored `type` |
| Record a measurement | `bakers_metric_write` | `ticket`, `name`, `rows` (`[{name, value, unit}]`), optional `label` | all metric rows; rows outside `<name>.` kept |

User, workspace, project, conductor, label, template, run, activity and time tools: [lookups](tools-lookup.md).
