# Call a bakers tool

Read before a run's first tool call. The site serves tracker operations as tools at `/mcp`; a skill
step names the tool, its arguments and the expected result.

## Transport

On the wire each tool is named `tool_api__<tool>` (`tool_api__bakers_ticket_read`).

- **The host lists the tool** (an MCP connector): call it with the step's arguments.
- **Otherwise** write the arguments to a JSON file and call it alone, with literal values; chaining sandboxes it:

  ```bash
  bakers dropsh tool tool_api__<tool> --data @<args.json>
  ```

  The file keeps Markdown byte for byte. Write it with a file tool or JSON encoder
  (`jq -n --rawfile body <file.md> --arg t <ticket> '{ticket: $t, type: "plan", body: $body}'`).

`bakers dropsh tool` lists tools; `--schema` after a name prints schemas.

## Results and errors

| Exit | Meaning | Next |
|---|---|---|
| 0 | success; JSON result on stdout | use the result |
| 1 | the tool refused; the message names the cause | report it; correct only arguments the message shows wrong |
| 3 | credentials rejected | `bakers dropsh auth status`, then report |
| 4 | invalid arguments or unknown tool, nothing sent | fix the arguments against `--schema` |
| 5 | HTTP or protocol error | report it; a write's outcome is unknown |

**An error is not a negative**: a failed read or search found nothing out. A write that timed out or
ended in exit 5 may have happened: reconcile with a read, never send it twice.

## Operations

`ticket` is an identifier (`<KEY>-<number>`) or UUID; outside comments, `type`, `recipe` and `label`
are term names, reused or created.

| Operation | Tool | Arguments | Result |
|---|---|---|---|
| Read a ticket | `bakers_ticket_read` | `ticket` | `id`, `identifier`, `title`, `state`, `workflow`, `description`, `type`, `recipe`, `labels`, `links`, `comments` (`id`, `type`, `body`, `created`, `author`; oldest first) |
| Search tickets | `bakers_ticket_search` | `query`, optional `project` | `tickets` (`identifier`, `title`, `state`, `type`) whose title or description contains `query`; newest first, at most 50 |
| Create a ticket | `bakers_ticket_create` | `title`, `workflow`, `project` (key or UUID); optional `description`, `type`, `recipe`, `parent` | `id`, `identifier`, initial `state` |
| Set recipe and type | `bakers_ticket_classify` | `ticket`; `recipe`, `type` or both | saved `recipe` and `type` |
| Change state or add links | `bakers_ticket_transition` | `ticket`; `state`, `links` (`[{uri, title}]`) or both | saved `state` and all `links`; existing links kept, no duplicate `uri`; no `state` keeps it |
| Publish a comment | `bakers_comment_publish` | `ticket`, `type`, `body` | new comment `id`, stored `type` |
| Record a measurement | `bakers_metric_write` | `ticket`, `name`, `rows` (`[{name, value, unit}]`), optional `label` | all metric rows; rows outside `<name>.` kept |
| Propose time | `bakers_time_propose` | `entries`; optional `project`, `account`; all UUIDs | `submission`, `worklogs` in entry order; a failing entry stores nothing |
| List own worklogs | `bakers_worklog_list` | `from`, `to` (`Y-m-d`); optional `limit`, `offset` | `data` (worklogs), `next_offset` |
