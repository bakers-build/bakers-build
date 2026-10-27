# bakers dropsh

`bakers dropsh` is an entity-agnostic shell over the control plane's JSON:API, bound to the same connection `bakers ui` uses; everything the agents write you can write by hand with it, and it validates before it sends.

## Synopsis

```
bakers dropsh [--config <path>] [--connection <id>] [--connections-dir <path>]
            [--auth-profile <id>] [--format <id>] [--view-mode <name>] <verb> ...
```

Put the global options before the verb. `bakers dropsh` also accepts `--yes`, which never prompts for a workspace.

## Global options

| Option | Meaning |
|---|---|
| `--config <path>` | Connection file to use; overrides every id-based selector |
| `--connection <id>` | Named connection, `~/.bakers/connections/<id>.js` |
| `--connections-dir <path>` | Directory that `connections list` reads (`$DROPSH_CONNECTIONS_DIR`) |
| `--auth-profile <id>` | Auth profile to use; overrides the active profile and `$DROPSH_AUTH_PROFILE` |
| `--format <id>` | Output: `json` (default) or a renderer id such as `md` |
| `--view-mode <name>` | Entity view mode for interactive renderers (default `default`) |

The connection is chosen by the same rule as in `bakers ui`: [Which control plane answers](/advanced/cli/ui#which-control-plane-answers). `--format md` renders `read`, `search`, `create` and `update` as Markdown; `delete`, `upload-file` and `schema` reject a renderer format. Errors go to stderr as structured JSON with stable exit codes: `2` configuration, `3` authentication, `4` validation, `5` HTTP error from the server, `6` plugin, `1` anything else.

## Targets and envelopes

A **target** is `entity_type/bundle/uuid`, for example `bb_ticket/bb_ticket/57738e90-...`. For bakers.build entities the bundle equals the entity type, except terms, whose bundle is the vocabulary: `bb_term/type/<uuid>`, `bb_term/recipe/<uuid>` or `bb_term/label/<uuid>`.

An **envelope** is a JSON:API document whose `data.type` is `<entity>--<bundle>`, with fields under `attributes` and `relationships`, given inline or as `@path` to a file. Alternatively `create` and `update` take **field parameters**, `--title "Hello"`, `--body.value "Text"`, `--<relationship> <uuid>`, or `--json <field>=<json>` for an array of objects; the two forms are mutually exclusive. `--fields` lists the parameters a bundle accepts, and an unknown field name is rejected with exit code `4` rather than ignored. `--dry-run` validates against the cached schema and prints what would be sent, without sending it.

bakers.build adds name fields to writes, resolved on the live write (a dry run shows them unresolved):

- `--type_names bug`, `--recipe_names <name>` and `--label_names agent:claude` set the ticket's `ticket_type`, `recipe` and `labels` from term names in the ticket's workspace. An unknown name is created in that workspace first, then linked; a create that names no project cannot create one and fails. `--type_names` and `--recipe_names` take one name and replace the previous value; `--label_names` adds to any `--labels` in the same write.
- `--environment_names staging` sets the environment; an unknown name fails before anything is sent.

## Verbs

| Verb | Options | What it does |
|---|---|---|
| `read <target>` | `--include <fields...>` sideloads relationships | Read one entity |
| `search <entity_type>` | `--bundle <bundle>` · `--filter <kv...>` · `--limit <n>` (default 50) · `--offset <n>` · `--sort <field>` (`-` prefix for descending) · `--include <fields...>` | List entities |
| `create <entity_type>` | `--bundle <bundle>` · `--data <json\|@path>` · `--dry-run` · `--no-validate` · `--fields` | Create one entity |
| `update <target>` | `--data <json\|@path>` · `--dry-run` · `--no-validate` · `--fields` | PATCH one entity |
| `delete <target>` | `--dry-run` | Delete one entity |
| `upload-file` | `--target entity_type/bundle/uuid/field_name` · `--file <path>` · `--dry-run` | Upload a file into a file or media field |
| `schema [target]` | `--for create\|update` (default `create`) · `--refresh` · `--fields` | The catalog, or the JSON Schema for `<entity>/<bundle>` |
| `connections list` | none | List the `.js` connections in the connections directory (default `~/.config/dropsh/connections`; pass `--connections-dir ~/.bakers/connections` to list bakers.build's named connections) |
| `auth <subcommand>` | `login [--provider <id>]` · `use <id>` · `logout [--profile <id>] [--all]` · `status [--json] [--profile <id>]` | Manage sign-in |

`bakers dropsh search bb_workspace` with no other arguments is answered by `bakers` itself, before a workspace is chosen: it prints the workspaces you can reach as JSON, or as a table with `--format md`.

### Filter operators

`--filter key:value` is equality; `--filter key:op:value` selects an operator. Relationship paths work, as in `ticket_id.id:<uuid>`. A value that contains a colon, such as a URL, stays intact.

| Operator | Meaning |
|---|---|
| `=` (omitted) | equals |
| `<>`, `!=` | not equals |
| `<`, `<=`, `>`, `>=` | comparisons |
| `CONTAINS`, `STARTS_WITH`, `ENDS_WITH` | substring, prefix, suffix |
| `IN`, `NOT IN` | comma-separated list: `--filter state:IN:plan,working` |
| `BETWEEN`, `NOT BETWEEN` | comma-separated `low,high` |
| `IS NULL`, `IS NOT NULL` | no value; quote it so the shell passes one argument: `--filter 'origin:IS NULL'` |

## Auth profiles

A current bakers.build connection declares one profile, `bakers`, with the `bb:session` scope and marked default, so there is nothing to choose between. What the signed-in identity may do is decided by its membership and rank on the server, not by the profile. Sign in with the connection selected first:

```sh
bakers dropsh auth login
bakers dropsh auth status
```

The default sign-in is a device code: `auth login` prints a URL and a short code, you confirm on any device, and it waits. Connections set up for unattended use sign in with client credentials instead. Tokens renew automatically and stay in private local state. An expired session, a missing membership and the wrong server are three different failures: tell them apart with `bakers dropsh auth status` and `bakers ui --print-config`. Profile fields and examples: [Connections](/advanced/connections).

## Examples

```sh
# the fields a ticket create accepts
bakers dropsh schema bb_ticket/bb_ticket --for create

# a project's uuid, and the labels
bakers dropsh search bb_project --bundle bb_project
bakers dropsh search bb_term --bundle label

# the comments of one ticket, oldest first
bakers dropsh search bb_comment --bundle bb_comment \
  --filter ticket_id.id:<ticket uuid> --sort created

# a ticket with its runs sideloaded, as Markdown
bakers dropsh --format md read bb_ticket/bb_ticket/<uuid> --include runs

# move a ticket to review, validated first
bakers dropsh update bb_ticket/bb_ticket/<uuid> --data @to-review.json --dry-run
bakers dropsh update bb_ticket/bb_ticket/<uuid> --data @to-review.json
```

## Writing tickets and comments

A state change is an `update` whose envelope sets the target `state`; the server maps it to an allowed transition and answers HTTP 422 for an invalid one. A comment is a `create` of a `bb_comment` whose `ticket_id` relationship names the ticket; the server fills the author. Rich-text fields, a ticket's `description` and a comment's `body`, are Markdown with `format: bb_rich`. Leave server-owned fields (identifier, number, state on create, base branch, author) out of an envelope. `branch_name` is the one exception, at creation only: set it to make a carrier ticket on a long-lived integration branch that its sub-tickets base on. Omitted, the server derives `feat/<identifier>-<title>`, and either way the value is frozen afterwards.

The comment type is free text in the attribute **`bb_comment_type`**, not `type`, which in JSON:API names the resource type. The conventional values and who writes them are in [Follow a ticket](/daily-work/follow-a-ticket).

| HTTP | Meaning |
|---|---|
| 401 | Token missing or expired; sign in again |
| 403 | The ticket is outside your access |
| 422 | Validation failed: a forbidden transition, a dependency cycle, a duplicate identifier, or a write outside the active run's ticket scope |

The last case binds a run's own identity, which may comment only on the ticket it claimed and that ticket's descendants; an identity whose rank lets it edit the ticket is exempt. If a newly added field value is rejected before any request is sent, the local schema cache predates it: run `bakers dropsh schema <entity>/<bundle> --refresh`.
