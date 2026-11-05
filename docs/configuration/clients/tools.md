# bakers tools

`bakers tools` lists, describes and calls the bakers.build server's named tools over its MCP endpoint, bound to the same connection `bakers ui` uses. Every tracker operation an agent performs is one of these tools; an agent that has the bakers.build MCP connector calls the tool of the same name natively, and `bakers tools` is the transport for everyone else.

## Synopsis

```
bakers tools [<global options>] [<wire name>] [--schema] [--data <json|@file>] [--param <key=value>]...
```

| Form | What it does |
|---|---|
| `bakers tools` | List the tools the server offers to your identity |
| `bakers tools <wire name> --schema` | Print the tool's input schema and, when it has one, its output schema |
| `bakers tools <wire name> --data @args.json` | Call the tool with the arguments in `args.json` |
| `bakers tools <wire name> --data '<json>'` | Call it with inline JSON arguments |
| `bakers tools <wire name> --param key=value` | Set one argument; repeatable, and wins over the same key in `--data` |

A tool's wire name is `tool_api__<id>`, for example `tool_api__bakers_ticket_read`. An unprefixed id such as `bakers_ticket_read` is an unknown tool. Prefer `--data @file` for anything but a one-word value: write the file with an editor, a file tool or a JSON encoder, so Markdown bodies survive byte for byte and no shell quoting gets in the way.

## Global options

| Option | Meaning |
|---|---|
| `--config <path>` | Connection file to use; overrides every id-based selector |
| `--connection <id>` | Named connection, `~/.bakers/connections/<id>.js` |
| `--connections-dir <path>` | Directory that holds the named connections (`$DROPSH_CONNECTIONS_DIR`) |
| `--auth-profile <id>` | Auth profile to use; overrides the active profile and `$DROPSH_AUTH_PROFILE` |

Global options follow the subcommand: `bakers tools --connection staging`. The connection is chosen by the same rule as in `bakers ui`: [Which control plane answers](/addons/bakers-ui/reference#which-control-plane-answers). Sign-in and profiles are covered in [bakers auth](/configuration/clients/auth).

## Results and exit codes

The tool's structured result is printed to stdout as JSON. Errors go to stderr as structured JSON.

| Exit | Meaning | Next |
|---|---|---|
| `0` | Success; JSON result on stdout | Use the result |
| `1` | The tool refused (`E_TOOL`), for example an unknown ticket or a forbidden state change; the message names the cause | Correct only the arguments the message shows wrong |
| `2` | Configuration error | `bakers config check --scope connection` |
| `3` | Authentication: credentials missing, expired or rejected | `bakers auth status`, then `bakers auth login` |
| `4` | Validation (`E_VALIDATION`): unknown tool, unreadable or invalid `--data`, or arguments outside the input schema. Nothing was sent | Fix the arguments against `--schema` |
| `5` | HTTP or protocol error (`E_HTTP`); `details.status` `0` means the response was lost | See the rule below |
| `6` | Plugin error | Check the connection's `plugins` |

**An uncertain write is not a failure.** A write that timed out or ended with exit `5` may have been applied on the server. The CLI sends each call once; never resend it. Reconcile first: read the ticket back (`bakers_ticket_read`) or search for the object you meant to create, and only act on what the read shows. Likewise, a failed read or search is not a negative: it found nothing out.

## Tools

Paged lists take optional `limit` (1 to 100, default 50) and `offset` (default 0) and return `next_offset`, which is `null` on the last page. `bakers tools <wire name> --schema` is authoritative for every argument.

| Tool | Arguments | What it does |
|---|---|---|
| `bakers_user_read` | none | Your own user: name, position and background, which describe you |
| `bakers_workspace_list` | `limit`, `offset` | The workspaces you can reach |
| `bakers_group_list` | `workspace`; optional `group` | A workspace's groups, or one group's subgroups |
| `bakers_group_create` | `workspace`, `name`; optional `description` | Create a group |
| `bakers_team_list` | `workspace` | A workspace's teams |
| `bakers_project_list` | optional `workspace`, `group`, `query` | Projects you can reach, with `key` and `uuid` |
| `bakers_project_read` | `project` (key or UUID) | One project with its group, teams, repository and coder configuration |
| `bakers_project_create` | `group`, `name`, `teams`; optional `description`, `repository`, `coder_config` | Create a project |
| `bakers_conductor_list` | `project` | A project's conductors and their status |
| `bakers_label_list` | `workspace`; optional `query` | A workspace's labels |
| `bakers_ticket_read` | `ticket` (identifier or UUID) | A ticket with its comments, oldest first, as an agent run reads it first, and `deployments`: each deployment ticket that carries it, with its `identifier` and `environments` |
| `bakers_ticket_search` | `query` or `branch_name`; optional `project` | Tickets matching a text or a branch |
| `bakers_ticket_list` | `project` (UUID); `limit`, `offset` | Every ticket of the project you can read, closed ones included, oldest first. Each row has `id` (UUID), `identifier`, `title`, `state`, `links` (`uri`, `title`), `labels` (names), `frozen`, `frozen_at` (ISO 8601 or `null`), `parent` (the parent's UUID, `null` when absent or unreadable) and `closed` |
| `bakers_ticket_create` | `title`, `workflow`, `project`; optional `description`, `type`, `recipe`, `parent`, `branch_name` | Create a ticket |
| `bakers_ticket_update` | `ticket`; any of `title`, `description`, `conductor`, `labels_add`, `labels_remove`, `frozen`, `environments_add`, `referenced_tickets_add` | Edit a ticket; values not given are kept, `labels_remove` drops only the named labels, `environments_add` and `referenced_tickets_add` only add; a closed ticket refuses every edit |
| `bakers_ticket_classify` | `ticket`; `recipe`, `type` or both | Set recipe and type by name |
| `bakers_ticket_transition` | `ticket`; `state`, `links` or both | Change the state or add links |
| `bakers_ticket_template_run` | `template` (UUID); optional `title`, `description`, `workflow`, `project`, `conductor`, `labels`, `target_state` | Create a ticket from a ticket template |
| `bakers_ticket_runs_list` | `ticket` | A ticket's agent runs |
| `bakers_ticket_activity_list` | `ticket` or `project` | The activity feed of a ticket or a project |
| `bakers_comment_publish` | `ticket`, `type`, `body` | Publish a comment |
| `bakers_metric_write` | `ticket`, `name`, `rows`; optional `label` | Record a measurement ([Ticket metrics](/configuration/workflows/metrics)) |
| `bakers_run_cancel` | `ticket`, `reason` | Cancel a ticket's active runs |
| `bakers_inbox_send` | `ticket`, `message` (e.g. `ports.tunnel`); optional `payload` | Send an addon message to the ticket's conductor, under the same access and payload rules as the web UI, and wait up to 30 s. Returns `id`, `status` (`pending`, `running`, `done` or `failed`) and the Markdown answer `markdown`; `failed` is the addon's answer, a refusal is a tool error |
| `bakers_inbox_read` | `message` (the UUID `bakers_inbox_send` returned) | The message's current `status` and `markdown`, without waiting |

The list printed by `bakers tools` is what your identity may call on this server; it can hold tools this table does not show. Type, recipe and label names are reused, or created in the ticket's workspace.

## Writing tickets and comments

A state change is `bakers_ticket_transition`; the server maps the target state to an allowed transition and refuses an invalid one. Rich-text values, a ticket's `description` and a comment's `body`, are GitHub-flavored Markdown: pipe tables render as tables, and the separator colons (`:---`, `:---:`, `---:`) align a column left, center or right. Raw HTML, `<table>` included, is removed, so write tables in Markdown. `branch_name` on `bakers_ticket_create` makes a carrier ticket on a long-lived integration branch that its sub-tickets base on. Omitted, the server derives `feat/<identifier>-<title>`, and either way the value is frozen afterwards.

The conventional comment types and who writes them are in [Follow a ticket](/get-started/daily-work/follow-a-ticket). A run's own identity may comment only on the ticket it claimed and that ticket's descendants; an identity whose rank lets it edit the ticket is exempt. Reads never show unpublished comments, such as submitted reviews that are not yet published.

Anything without a tool, such as uploading a file or editing a ticket template, is done on the web application's own screens.

## Examples

```sh
# what the server offers, and the arguments one tool takes
bakers tools
bakers tools tool_api__bakers_ticket_create --schema

# a ticket with every comment
bakers tools tool_api__bakers_ticket_read --data '{"ticket":"<identifier>"}'

# the projects of a workspace, on another connection
bakers tools --connection staging tool_api__bakers_project_list --param workspace=<workspace uuid>

# move a ticket to review: write to-review.json, then call
#   {"ticket": "<identifier>", "state": "review"}
bakers tools tool_api__bakers_ticket_transition --data @to-review.json
```
