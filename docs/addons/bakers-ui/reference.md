# bakers ui

`bakers ui` is bakers.build's terminal cockpit: it opens on **My work**, your open assigned tickets, and adds projects, teams, ticket lists, ticket and run detail and conductors, all against one control plane.

This page covers how the cockpit connects and what each screen shows; deep links, auto-refresh and every key are on [bakers ui keys](/addons/bakers-ui-keys), and a first walk-through is in [Terminal UI](/addons/bakers-ui/usage).

## Synopsis

```
bakers ui [target] [--ticket <id>] [--project <id>] [--run <uuid>] [--here]
        [--view <mode>] [--config <path>] [--connection <id>]
        [--workspace <name|uuid>] [--yes] [--print-config]
```

| Option | Effect |
|---|---|
| `target`, `--ticket`, `--project`, `--run`, `--here` | Open one thing; at most one per call ([deep links](/addons/bakers-ui-keys#deep-links)) |
| `--view <mode>` | How a ticket renders: `full`, `teaser` or `board_card` |
| `--config <path>` | Connection file to use; wins over every other selector |
| `--connection <id>` | Named connection from `~/.bakers/connections` |
| `--workspace <name\|uuid>` | Workspace for this run only |
| `--yes` | Never prompt for a workspace |
| `--print-config` | Print the resolved connection and exit |

The renderer needs the Bun runtime that `@bakers-build/addon-bakers-ui` installs, so `bakers ui` re-runs itself under it (`--print-config` stays on Node); `BB_UI_NO_BUN=1` uses Node 26 or later with `--experimental-ffi` instead.

## Which control plane answers

`bakers ui` loads its connection like `bakers tools`; first match wins:

1. `--config <path>`, else `$BB_CONFIG`, else `$DROPSH_CONFIG`.
2. `--connection <id>`, else `$BB_CONNECTION` or `$DROPSH_CONNECTION`.
3. The checkout's selector file, `.bakers/connection.config.local.js`, which names one connection.
4. The default connection, normally `~/.bakers/bakers.config.js`.

When the cockpit talks to a server you did not expect, run `bakers ui --print-config`: it prints the connection file, how it was selected (`selection`), `base_url` and the project's `.bakers` directory (`bb_dir`). Precedence in full: [Connections](/configuration/connector/connections).

## Which workspace

Inside a checkout the workspace comes from `bakers.workspace` in the conductor config, otherwise from the connection; `--workspace` overrides both for one run. `W` opens the workspace picker, and `Enter` writes the choice to `bakers.workspace` and restarts the cockpit.

## Navigation - seven scopes

Navigation has seven tab scopes. Tabbed screens show the bar for their current scope; compact ticket views, forms and run detail have no separate tab bar. `Tab`/`Shift-Tab` cycle the tabs of the current level, and a **left click on a tab** goes straight to it; tabs have no letter shortcuts.

| Level | Tabs |
|-------|------|
| Root | **My work** · **Projects** · **Teams** · **Members** (workspace lead only) · **Conductors** |
| Project | **Overview** · **Work** · **Tickets** · **Runs** · **Conductors** |
| Ticket | **Overview** · **Planning** · **History** · **Runs**, plus enabled tabs such as **Artifacts**; a message addon is an Overview card |
| Team | **Overview** · **Work** · **Members** |
| Workspace member | **Overview** · **Tickets** · **Runs** |
| Team member | **Overview** · **Tickets** · **Runs** |
| Conductor | **Overview** · **Held work** · **Assigned** · **Log** |

Run detail has no bar; `Esc` returns to the preceding screen. An addon places a tab with `weight` or `before`/`after` anchors: see [Adding a screen as a tab](/addons/bakers-ui/tabs) and [Addons](/addons/configure).

**Every bar is drawn in the same row**, under the header box, and is clickable where it is drawn and only at its own level: on root **Projects** a click at the column where the project bar's `Runs` would sit is inert, because that bar is not there. On the ticket screen the same column may fall inside ` Runs `, opening that tab, but still reaches no project screen. Project, Team, Workspace Member and Team Member **Overview** are intentionally empty.

**Team Members** is a read-only OG roster reached through Root → Teams → one team. Enter opens that person inside the selected team, where Tickets and Runs are limited to both the person and the team's linked projects. The root **Members** tab is separate, for workspace leads.

## The ticket sections

**Overview** leads with the **latest summary**: the newest comment whose `bb_comment_type` is `summary`, the handoff that says where the work stands. It is a collapsible entry, a five-line extract until expanded, and "newest" is the History tab's own order. The type match is exact, so a ticket with no `summary` comment, a typo included, shows "No summary comment."

**Latest spec**, **Latest plan** and **Latest test** live on **Planning** under the same rules. **Description** starts expanded; collapsed it shows five lines, then `… +N more lines`. At 100 columns or wider a sidebar adds **Details** and **Related**: parent, sub-tickets, referenced tickets and **Blocked by**, one `<identifier> · <title>` row per blocker.

The header box keeps the identifier, title, labels, state, **Assigned** and **Created by** (the ticket's owner, `unknown` without one) on screen while the body scrolls.

The ticket's **labels** and its **state** are full-width rows of the header box, in that order under the title (`Labels: agent:claude`, `State: working`). Each is its own row rather than appended to the title, because a too-narrow terminal truncates a shared row and they would appear or vanish by terminal width.

A piped render has no header box, so State and Labels are sections of their own there.

### Markdown bodies render as Markdown

Every Markdown body on the ticket detail (the description, the latest summary, spec, plan and test, and every comment) is rendered as Markdown within the terminal's capability: on Overview, Planning and History, and in `bakers ui <id> | cat`, where the parsed text prints without styles. Nothing else is parsed: state, labels, runs, links, branch rows and the cockpit's own marker rows stay plain.

Rendered: headings, `**strong**`, `*em*`, `~~struck~~` (dim), code, lists, quotes, rules and `[text](url)` (shown as `text (url)`). GFM tables, setext headings, reference links, footnotes and raw HTML are shown raw. `__strong__` is raw too, because it cannot be told apart from `__init__`; write `**strong**`.

**Fences, exactly.** A backtick fence's info string may not hold a backtick, so ```` ```code``` ```` is **not** a fence: it is an ordinary line carrying a code span. A `~~~` fence has no such restriction. An **unterminated** fence loses its opening row along with every other fence row, and everything after it is fenced content to the end of that body, never past it. CRLF and a lone CR are normalised to LF before parsing, so a description typed into the web form **renders identically** to one written with Unix line endings. Only markers the renderer matched are removed; anything it cannot resolve comes back as written.

### Runs

The ticket's **Runs** tab lists its runs as selectable rows, newest started first. `Enter` (or a click) opens the **run detail**: state, timing, footprint (tokens, tool calls, agent turns), worktree and the full, scrollable **Log** and **Error log**. A run in state `claimed` or `running` also offers `e` to cancel it.

The project **Runs** tab lists the project's runs, newest first, 20 per page. A `running` or `claimed` run with a heartbeat older than 600 seconds, or a lapsed claim lease, shows as `stale`. Lists state `N of M ticket(s)`: rows on screen of all rows matching the filters, `M` from the server's `meta.count`, or `?` when it reports none.

### Editing a ticket

`e` opens the `✎ Edit ticket` popup: assignee, conductor, estimate, spent, **Parent** and **Labels**. **Save** (`Ctrl+S`) never writes the state. **Cancel ticket** (non-terminal tickets only) writes only `state: cancelled`, discards unsaved edits and asks no confirmation; a forbidden transition shows a 422. A closed ticket's popup is read-only.

## The conductor sections

`Enter` on any Conductors row opens that conductor, whichever machine it runs on. Four tabs share one read of it:

- **Overview**: status, last-seen age, machine, project, workspace path, PID, and load as `<current>/<max>`, the host's budget that several conductors share.
- **Held work**: its runs in state `claimed` or `running`; `Enter` opens the run's ticket.
- **Assigned**: its open tickets.
- **Log**: the tail of its `log.txt` when this machine owns it, else a note that it runs on another machine.
