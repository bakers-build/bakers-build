# @bakers-build/addon-bakers-ui

The bakers.build terminal UI: a dropsh `tui` renderer plugin (`bakers ui`). It opens on
**My work**, the current operator's open assigned tickets, and also shows a
**Stats** view of ticket and run statistics, project/team current work, a
searchable/filterable ticket list, and ticket detail, and manages
**ticket-create agents** — hideable, re-attachable claude sessions that create
bakers.build tickets.

## Navigation — seven scopes

Navigation has seven tab scopes. Tabbed screens show the bar for their current
scope; compact ticket views, forms and run detail have no separate tab bar. `Tab`/`Shift-Tab` cycle the tabs of the current level, and
a **left click on a tab** goes straight to it; there are no letter shortcuts for
tab navigation.

| Level | Screens | Tabs |
|-------|---------|------|
| Root | Personal work, statistics, projects, teams, conductors, and workspace members for leads | **My work** · **Stats** · **Projects** · **Teams** · **Members** (workspace lead only) · **Conductors** |
| Project | Project-scoped screens | **Overview** · **Work** · **Stats** · **Tickets** · **Ticket-Agents** · **Runs** · **Conductors** |
| Ticket | Independent ticket screens | **Overview** · **Planning** · **History** · **Runs**, plus enabled tabs such as **Artifacts**; a message addon is an Overview card |
| Team | Team current work, statistics, and roster | **Overview** · **Work** · **Stats** · **Members** |
| Workspace member | A selected workspace member, for workspace leads only | **Overview** · **Stats** · **Tickets** · **Runs** |
| Team member | A selected member within one team | **Overview** · **Stats** · **Tickets** · **Runs** |
| Conductor | A selected conductor, reached with Enter from any Conductors list | **Overview** · **Held work** · **Assigned** · **Log** |
| — | Run detail | none — `Esc` returns to the preceding screen |

Built-in and addon tabs are derived from the same route registry. Addons can
insert a normal screen into any of these scopes using `weight` (10, 20, 30, …),
with intermediate values such as 25 or optional `before` / `after` anchors. See [Adding a screen as a tab](docs/tabs.md) for registration, placement,
validation and migration examples.

Project, Team, Workspace Member, and Team Member **Overview** are intentional
empty landing places. Their historical figures live on the adjacent **Stats**
tab. Ticket Overview remains populated and unchanged.

**Every bar is drawn in the same row** — under the header box (BB-346). The
ticket detail's sections used to be drawn *inside* that box, as its last content
row, which made the ticket screen the one screen with a bar in a different place;
they are now ordinary entries of the `ticket` level and the chrome draws them like
any other level's. That move was `chromeHeight`-neutral — two content rows plus a
bar row is the three content rows the box used to have — and BB-369's **state**
row then added one, so the ticket screen's header box is five rows
(frame · title · **labels** · **state** · frame) plus the bar row, one row taller
than before that row existed, and the run detail screen's is the plain four with no
bar. Every screen's chrome height is derived from the rows it actually writes
(`headerRowCount()` = `childrenOf(header).length`, before Yoga runs), which is what
keeps a click on the row it points at — and why the state row costs one body row on
every ticket detail.

**Chrome colours (BB-375).** Indexed palette only (`src/lib/theme.ts`): body
is a rounded **BORDER** frame with **no** fill (content scrolls inside);
active/selection wash **237**, ordinary text / borders **245**, highlight /
border emphasis **231**, active / selection fg **15** (full white). Header, tab bar and
footer have **no** background fill. No cyan slots. Interactive TTY boots show a
timed **bakers** ASCIIFont splash (`SPLASH_MS = 500`); piped / non-TTY runs never
enter it, and injected-renderer harnesses skip it by default.

Each ticket tab is an independent screen and route. Switching tabs performs
router navigation without adding a back-history entry. Each screen retains its
own cursor and expansion state. Ticket documents are shared through a
session-scoped, memory-only store: a tab loads only missing relationships;
refresh invalidates the active ticket data, and writes update the store.

Piped full-ticket output follows the same weighted tab order: one title, then
Overview, Planning, History, Runs and enabled addon reports. Each screen contributes
its own block, including fields it shares with another screen. Compact ticket
views continue to print only their own fields.

Each bar is clickable where it is drawn, and only ever at its own level: on root
Stats a click at the column where the project bar's `Runs` would sit is inert,
because that bar is not there. On the ticket screen the same column may fall inside ` Runs `, opening that tab, but still reaches no project screen.

Every project tab is **project-scoped**, so open a project first. The project
Conductors tab lists that project's conductors. Only registered screens appear
in a tab bar.

**Team Members** is a read-only OG roster reached through Root → Teams → one
team. It shows each active member's current Open, Running, and Waiting counts,
including zeroes. Enter opens that person inside the selected team. Team-member
Tickets and Runs are constrained by both the person and the team's linked
projects; Stats projects only that person's disclosed team breakdown rows. The
root **Members** tab is separate and is registered only for a confirmed
workspace lead; its member routes use workspace-wide user figures and lists.

## Screens & keys

| Screen | Keys |
|--------|------|
| Stats | `PgUp`/`PgDn`/`g`/`G` scroll · `Tab`/`Shift-Tab` cycle tabs · `n` new ticket agent · `q` quit |
| Workspace/Team Members | `↑↓` select · `Enter` open member · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| Projects | `↑↓` select · `Enter` open project · `n` new ticket agent · `Tab`/`Shift-Tab` cycle tabs · `q` quit |
| Project | `↑↓` select · `Enter` open ticket · `n` new ticket agent · `Tab`/`Shift-Tab` cycle tabs · `/` search · `s` status filter · `t` type filter · `p` parent filter · `x` closed filter · `c` clear · `R` reload · `←`/`→` previous/next page · `Esc` back |
| Ticket | `Tab`/`Shift-Tab` switch section · `↑↓`/`jk` move between the section's entries — Overview, Planning and History select, one per run on Runs — and fall through to the body scroll at either end · `PgUp`/`PgDn` page the ticket body when no modal is open · `g`/`G` first/last entry · `Enter`/`Space` expand the selected entry · `Enter` on a run row opens it · `e` edit ticket (assignee · conductor · estimate/spent · cancel) · `Esc` back |
| Run detail | `↑↓` scroll · `e` cancel a claimed/running run · `Esc` back to the ticket's Runs tab · `q` quit |
| Ticket-Agents | `↑↓` select · `Enter` switch to agent (zoom full-screen) · `z` tiled overview · `r` retry · `x` close · `Tab`/`Shift-Tab` cycle tabs · `Esc` back |
| Runs | `↑↓` select · `Enter` open the run's ticket (Runs sub-tab) · `Tab`/`Shift-Tab` cycle tabs · `x` closed filter · `R` reload · `←`/`→` previous/next page · `Esc` back |

### Auto-refresh (`.bakers/ui-refresh`)

An interactive cockpit inside a project watches that project's `.bakers/` directory. To say that its
data may be stale, create or update the signal file:

```
touch .bakers/ui-refresh
```

The content is meaningless; the file's modification time is the signal. A bump runs the same reload
as `R` on the active screen, while keeping manual `R` available. The footer reads
`R reload (auto) ·` while the watcher is live and `R reload ·` without one.

Events closer together than 300 ms are coalesced into one reload, and a continuous stream waits until
it pauses for one window. A screen that declares no reload — including forms, the project picker and
popups — is not reloaded, and a bump is not remembered for later. Piped runs build no watcher, nor does
a cockpit without a resolved project `.bakers/` directory. The transient signal file is git-ignored;
nothing in bakers.build writes it automatically yet.

`Tab`/`Shift+Tab` mean two different things, and which one you get depends on
what is on screen. On a **screen** they cycle that level's tab bar, as the rows
above say. Inside a **modal form** — the new-ticket popup, the Who picker, the
parent filter, the assignment edit — they move the form's own cursor instead,
mirroring `↓` and `↑` exactly: forward and back through the fields, and — on the
**parent filter**, the one picker that tells the key module how many fields it
has — through its suggestions. The **Who picker** is the same one-field shape but
does not tell it, so there both keys stay field moves, and a form with one field
has nowhere to move them: they do nothing. That gap is real and small, and left
to its own ticket — telling the key module would change behaviour on a screen
outside the surface that needed the key. A modal form has no tab bar of its own,
so nothing is shadowed; the tab bar belongs to the screen underneath and comes
back when the form closes.

The `✎ Edit ticket` popup edits assignee, conductor, estimate, spent, **Parent**
(project-scoped autocomplete, clearable, never offering the open ticket as its
own parent), **Type** and **Recipe** (clearable single selects from the `type` /
`recipe` vocabularies) and **Labels** (multi-select from `label`). Ordinary **Save**
(`Ctrl+S`, or Enter on `[ Save ]`) PATCHes those fields and never writes
`state`. **Cancel ticket** is a second action on non-terminal tickets only
(`done` / `cancelled` omit it); activating it PATCHes only `state: cancelled`
and discards any local field edits — no confirmation step. `Ctrl+S` always
saves even when the cursor is on Cancel ticket. `Esc` closes the popup without
writing (`Esc close` in the chrome). The server remains the only transition
guard — a forbidden cancel comes back as a 422 rendered in the popup.

### Stats figures

Stats shows ticket and run activity over the **trailing 24 hours, 7 days
and 30 days**. Tickets are windowed on `closed_date` (closed tickets in the
window); runs are windowed on `created`. The windows are **rolling durations**,
not calendar buckets — "the last 30 days" is 30 × 86 400 seconds, so no timezone
is involved — and they nest, so `24h ⊆ 7d ⊆ 30d`.

Every figure is read at render time from the control plane's aggregate endpoint
**`/jsonapi/bakers/statistics`**, which counts server-side and returns one document
per configured figure; nothing is counted or cached in the CLI. Discovery names
the figures available for the current account, project, team, or member scope;
the client does not invent a figure list or calculate historical aggregates.

Ratios arrive already calculated and formatted by the server. On Team Member
Stats, only matching rows from server-disclosed breakdown figures are shown;
aggregate, series, ratio, foreign-user, and unattributed rows are not
reinterpreted as member figures.

A breakdown row the server could not attribute — a ticket with no assignee, a run
with no ticket — is shown as **`— unattributed`** rather than dropped, so the
rows always sum to the total. Each bar is scaled against the **largest value in
its own group**, not against a quota: a full bar means "the biggest of these",
never "100 %".

A control plane that does not serve the endpoint (one deployed before BB-256)
gets a **named message** saying so rather than a blank screen or invented zeroes,
and every other tab keeps working. A real outage is reported as the error it is —
the two are told apart, so a 500 is never dressed up as an out-of-date control
plane. An instance with nothing in the window says *"No activity in the last 30
days."*

`bakers ui | cat` prints My work and `bakers ui project:<name> | cat` prints that
project's current Work surface, following the TTY. When a statistics endpoint is absent its message goes to
**stderr** and the exit status is non-zero, so a script sees a failure instead of
empty output.

### The ticket sections

**Overview** leads with the **latest summary** (BB-369): the newest comment whose
`bb_comment_type` is `summary` — the phase handoff that says where the work
stands, which is what an operator reads before the ticket's own body. It is a
collapsible entry of its own, above the description, and *"newest"* is
`commentResources()`' total newest-first order (`created` DESC →
`drupal_internal__id` DESC → resource id DESC), the History tab's own, never the
include's arrival order — one function, so the two surfaces cannot name different
comments. Collapsed it shows a five-line extract; `Enter`/`Space` expands it to the
whole comment. The type match is exact and `bb_comment_type` is free text, so a
ticket with no comment typed `summary` — a typo (`summarys`) included — renders the
single explicit line *"No summary comment."*. Section headers have **no
carets**; a click on a header selects and toggles in one step.

**Latest spec**, **Latest plan** and **Latest test** live on the **Planning** tab,
not Overview. Same newest-wins order and exact type match as summary. Each type
always has an entry: when the document is missing the copy is *"No spec comment."*,
*"No plan comment."* or *"No test comment."*, and Planning starts with every
document collapsed.

**Description** follows Latest summary on Overview and **starts expanded**.
Collapsed it uses the same **short summary** of its text: leading blank lines and
leading ATX headings (`## Context`, which every bakers.build body opens with) are skipped,
the run of consecutive non-empty lines that follows is taken, and it is capped at
**5 parsed lines**, then an explicit `… +N more lines` marker when more remains.
Technical details (branch, conductor, time, environments — not the assignee) starts
collapsed. Nonempty result **links** sit between Description and Technical details;
empty links are omitted. The **parent** and **related** links are shown in the Overview sidebar's Related tab.
The Related pane lists **source** first — the ticket's `origin` URL (the upstream
issue it was imported from), activatable like the other link rows when it starts
with `http`, and `none` when the ticket carries no origin — followed by **parent**,
**sub-ticket**, **blocked by** and **referenced**.

Overview therefore carries several selectable entries (summary, Description, any
links, Technical details), so its `cursorMode` is `select` rather than `scroll`:
`↑↓` (or `j`/`k`) move the **selection** between them, `g`/`G` jump to the first
and the last, and `Enter`/`Space` acts on the selected one. At either end of the
selection — `↓` on the last entry, `↑` on the first — the arrows **fall through to
the kernel's body scroll** instead, one row per press. `PgUp`/`PgDn` page the
ticket body by almost one viewport when no modal is open. Wheel scrolling is
unchanged.

The header box keeps identifier, title, labels, state, **Assigned** and
**Created by** on screen while the body scrolls. The ticket's **type** and
**recipe** names sit on its meta line beside the labels, and the piped render
lists them as `Type` / `Recipe` sections after `Labels` (`No type.` /
`No recipe.` when unset). Creator has no authoritative
ticket field, so ordinary records show `Created by: unknown`.

**Relationships** lists the parent too, and a **Blocked by** section between sub-tickets
and referenced tickets (BB-369): one identity row `<identifier> · <title>` per
ticket in the open ticket's `blocked_by`, on the same ladder `parentLines()` uses
(sideload → raw uuid, never an empty row), and *"Not blocked."* when there are none.
`loadTicketDetail()` carries `blocked_by` in its include set for exactly that — the
sideload ships `identifier` under the pinned `session` profile. **Sub-tickets** and
**Referenced tickets** deliberately stay **counts**: rows for those need their own
selection and navigation, which is a separate change. A blocker row carries no state
of its own — it would break the row format `Parent` establishes on the same tab, and
the identifier is the jump target.

The ticket's **labels** and its **state** are full-width rows of the header box, in
that order under the title (`Labels: work:code`, `State: coding`) — each its own row
rather than appended to the title, because `fitLine` truncates and a shared row would
make them appear or vanish by terminal width. `Labels: —` when the ticket has none,
`State: —` when it carries no state — `headerState()` uses `||`, not `??`, so an
absent attribute and an empty string are the one case they are for a display row;
`headerLabels()`
and `headerState()` are the one source each surface reads. The header box does not
depend on the open section, which is the point of putting the state there: it stays
on screen on Planning, History, Relationships and Runs alike. It is drawn in `teaser` and
`board_card` too, where it repeats the compact block's own `state` field — accepted
deliberately, because a row conditional on the view mode would branch the
body-window geometry per mode for one row of cosmetics.

`State` and `Labels` are additionally sections of the flat `bakers ui <identifier> | cat`
render that **no tab lists**: the pipe has no header box, so without them it would be
the one rendering that silently lost those facts. `detailSections()`' order — which
is the pipe's — is State, Labels, Parent, Latest summary, Latest spec (when
present), Latest plan (when present), Description, Assignment, Time, Comments,
Sub-tickets, Blocked by, Runs, Referenced tickets, Links, Branch, Environments,
independent of the tab order because `sectionsForTab()` looks each heading up by
name.

#### Markdown bodies render as Markdown

Every `bb_rich` body on the ticket detail — the **description**, the **latest
summary**, **latest spec**, **latest plan**, **latest test**, and **every comment** —
is rendered as Markdown within the terminal's capability: on Overview (open
Description and the summary extract), on Planning, on History, and in
`bakers ui <id> | cat`. Interactive bodies paint through the shared parser and wrap
with `wrapMode: word` inside the parent width; the pipe still prints the parsed
text without styles. All of them go through one function, so they cannot render
differently from one another.

Two kinds of rows inside those sections are **not** bodies and stay plain: the
`— <type> · <author> · <created>` marker Latest summary / Latest spec / Latest plan
open with, and the `— <type> ·` marker each comment opens with. They are the
cockpit's own text, not the author's. Nothing else on the screen is parsed either:
state, labels, assignment, time, the runs table, the blockers, the structured links
list and the branch rows hand over plain text, so a branch called `feat/a_b_c` or a
link title holding a `*` cannot be re-styled or re-spelled.

Interactive Markdown **wraps** at the parent width (`wrapMode: word`), so a long
URL or code token reflows instead of being clipped. The pipe remains unstyled
plain text. A fenced block is still the only piece of block state in the parser:
the fence rows are dropped, the content is indented and not re-parsed. `PgUp` /
`PgDn` page the ticket body; they do not change how a line wraps.

| you write | you see |
|---|---|
| `# …` … `###### …`, optional closing `#`s | the markers gone, the whole row **bold** |
| `**strong**` | **strong** |
| `*em*`, `_em_` | *italic* |
| `***both***`, `**_both_**` | ***bold italic*** |
| `~~struck~~` | dim (not strikethrough — see below) |
| `` `code` ``, `` ``code with a ` inside`` `` | the backticks gone, painted with indexed `BORDER` |
| `- item`, `* item`, `+ item` | `• item`, at the item's own indent |
| `- [ ] task`, `- [x] task` | `☐ task`, `☑ task` |
| `1. item`, `1) item` | the marker kept verbatim |
| ```` ``` ```` / `~~~` block, info string or not (with one exception, below) | the fence rows **dropped**, the content two columns in with `BORDER`, and **not** parsed |
| `> quoted`, `>> nested` | `│ ` per level, the quoted text dim |
| `---`, `***`, `___` | a fixed `────────`, dim |
| `[text](url)`, `![alt](url)` | `text (url)` — the address stays in the text |
| `<https://x>` | `https://x` |
| `\*`, `\_`, `` \` ``, `\[`, `\~`, `\\` | the literal character, the backslash gone |
| a bare `https://…` | unchanged, and tappable (OSC 8) |

**What it does not do, and what happens instead.** GFM **tables**, **setext**
headings (`===` / `---` *under* a line), **reference** links and definitions,
**footnotes** and raw **HTML** are shown raw, character for character — a table
needs columns a one-line renderer has none of, and `bb_rich` itself renders a
pipe table as one paragraph anyway. `__strong__` is **also** raw: it is
indistinguishable from `__init__`, and keeping a real identifier intact matters
more than a second way to write bold, so use `**strong**`. `~~struck~~` takes dim
rather than strikethrough, and `*em*` takes italic, because those are the only two
codes the cockpit is willing to put on the wire beyond what it already used —
underline is what a terminal hyperlink looks like and would collide with
`text (url)`. A **collapsed comment header** shows its preview as plain text (the
whole row is drawn bold), and the **pipe** carries no styling at all by definition.

**Fences, exactly.** A backtick fence's info string may not itself hold a
backtick, so ```` ```code``` ```` is **not** a fence: it is an ordinary line
carrying a code span, and it renders as one. `~~~` has no such restriction, so
`~~~a~~~b` does open a fence. An **unterminated** fence loses its opening row
along with every other fence row — that row opens a code block whose info string
is metadata rather than content, and a renderer reading one line at a time cannot
know the closer never comes. Everything after it is fenced content to the end of
that body, and never past it: the fence state is held for one body only, so an
unclosed fence in a comment cannot swallow the next comment.

**Line endings.** CRLF and a lone CR are normalised to LF before anything is
parsed, so a description typed into the control plane's web form **renders
identically** to one written with Unix line endings — the authoring path is not a
second dialect.

The invariant behind all of it: **only markers the renderer matched are ever
removed.** Anything it cannot resolve — an unbalanced `**`, a lone backtick, `_`
inside an identifier — comes back exactly as written. A mis-parse can cost you a
marker; it can never cost you a character of content.

The ticket's **Runs** tab lists that ticket's `bb_run` entities as **selectable
rows** — the same table the project-wide Runs screen draws, so a run looks
identical in both places — ordered newest-started first by a total comparator
(`started_at` DESC → `drupal_internal__id` DESC → resource id DESC; an unparseable
date sorts last). It costs **no extra request**: the ticket document's `runs`
include already ships each run's full attribute set. No runs ⇒ *"No runs for this
ticket."*

`Enter` (or a click) on a run row opens the **run detail screen**, rendered from
that same sideloaded resource — again no read, so nothing there can fail — with
sections **Run** (`#<id> · <uuid>`, the owning ticket) · **State** (state, phase,
agent, conductor) · **Timing** (started, heartbeat, claim expiry, duration) ·
**Footprint** (tokens, tool calls, agent turns, user prompts, prompt words) ·
**Worktree** · **Log** / **Error log** (the `text_long` values, uncapped and
scrollable — a truncated log would be a silent lie; *"No log captured."* when they
never were). Completed runs are read-only; claimed and running runs expose `e`
to open the cancel confirmation. `Esc` returns to the ticket's Runs tab.

`bakers ui run:<uuid>` opens that run's screen directly, with its ticket's Runs tab
one `Esc` underneath; piped (`| cat`) it prints the same run block, so the target
means one thing whether or not stdout is a terminal.

The project-level **Runs** tab lists the selected project's `bb_run` entities
(`ticket_id.project_id.id`-scoped, `started_at` DESC, **20 rows per page**, moved
with `←`/`→`; BB-292 `LIST_PAGE_SIZE`) in a flat table —
columns **RUN** (`#<id>`) · **TICKET** · **STATE** · **PHASE** (`state_at_start`)
· **AGENT** · **STARTED** (relative age). STATE is derived: an active
(`running`/`claimed`) run whose heartbeat is stale (> 600s) or whose claim lease
has expired shows as `stale`. Empty projects show *"No runs for this project."*;
loading/errors use the shared status-bar pattern.

### How many rows there are (the `N of M ticket(s)` / `N of M run(s)` count)

Both list screens state two quantities side by side: the rows **on screen**, and
the size of the **filtered collection** — every row matching the active criteria
(BB-292 D6c). `20 of 107 ticket(s)` means twenty rows drawn out of a hundred and
seven that match. Neither number replaces the other, so the row count never
silently changes meaning.

The total is the server's own: since BB-305 every `bb_*` collection reports it
as a document-level **`meta.count`** on the page response
(`BbResourceType::includeCount()`), so it arrives **with the rows, in the same
read** (D6e). Three consequences, and they are properties rather than promises:
the total cannot delay the first paint, because there is no second request to
wait for; paging costs exactly one read per page and re-states the total without
re-counting; and a total can never appear beside rows it does not describe,
because the server answered both from one query.

A control plane that reports no total is **not guessed at**. The line then reads
`20 of ? ticket(s)` — the `?` sits in the total's own place, so "this server does
not report a total" is not spelled the same as "counted" (D6d). That is also what
an absent `meta`, a `meta` without a `count`, or a `count` that is not a usable
number renders as. The older `20+` marker is gone with the background walk it
belonged to: it claimed a *lower bound on the collection*, which is a claim about
the rows rather than about the total, and on the last page it was simply false.

While a page is still loading there is nothing on screen but `Loading tickets…`,
so the segment is **omitted** entirely rather than stating a row count that is not
the rows on screen.

> **Historical note.** Before BB-305 the control plane really did emit no total,
> and this number was walked in the background — the list's own query at the
> server's 50-row cap, read sequentially to `links.next`, bounded at 150 reads.
> That cost 3 reads for 105 open tickets, 28 (~9.3 s) for 1340 open runs and 65
> (~36 s) for the closed ones. The walk and its read budget are **deleted**, not
> bypassed.

### New-ticket popup (`n`)

`n` opens a centered popup (a real modal overlay drawn on top of the current
screen) with, top to bottom, a **Title**, a multiline **Description**, a
searchable **Parent**, and live-loaded **Assignee** (users), **Conductor**,
**Type** and **Recipe** (single terms from the `type` / `recipe` vocabularies,
opened empty and clearable), **Labels** (multi-select) and **Workflow** (the
one `bb_work` workflow) selects. The operator's own user
(by username) and own conductor (by `machine_id`, from the machine context /
config) are preselected as defaults. **Title** comes first because
`bb_ticket.title` is required server-side — nothing derives it from the
description. **Conductor** is the one select that can be **cleared** (`Del`, or
`Backspace`): a set conductor means the ticket is claimed at the next poll and a
run starts, a cleared one means it waits for a human, and the field is clearable
precisely so that choice is the operator's.

The popup ends in **two submit rows** — `[ Create with agent ]` and
`[ Create directly ]` — and the key hints occupy two rows at the bottom of the
popup, inside the frame (the kernel draws the status line as part of the modal's
body, so it is framed like every other row). Two rows, because the frame's inner
width is at most 60 columns (`Math.min(60, width - 8)`, so a narrow terminal gets
fewer) and one row does not hold them:

```
 ↑↓ field · ←→ change · Space toggle
 Ctrl+S agent · Ctrl+D direct · Esc cancel
```

Both actions are always drawn, wherever the popup was opened from. `Ctrl+S`
presses the action row you are standing on and from any other field means the
agent — exactly what it meant before there was a second action; `Ctrl+D` creates
directly from any field; `Enter` on an action row fires that row. `Tab` and
`Shift+Tab` walk the fields forward and back, the same two steps `↓` and `↑`
take.

- **Create with agent** (`Ctrl+S`) is the original path: the collected fields go
  into a temp JSON spec and an embedded agent runs the create workflow,
  interviewing the operator for whatever is missing.
- **Create directly** (`Ctrl+D`) writes the ticket itself — one POST, no agent,
  no qualification handoff. The typed text becomes the ticket's description
  verbatim (format `bb_rich`), the picked workflow, assignee, conductor,
  type, recipe, labels and parent are written as they stand, and everything the server owns
  (`state`, `identifier`, `number`, `branch_name`, `base_branch`) is left to the
  server, so the ticket lands in the workflow's first state. It needs a
  **project**, because a ticket without one draws no number and gets no
  `bakers.build-nnn` identifier (BB-664 AC-8): opened from a project, the project is
  already in scope and the popup carries it in silently, exactly as before.
  Opened from a root screen with none in scope, the popup instead opens on an
  extra **Project** field, ahead of Title — an autocomplete searched over the
  same project picker the ticket list's project filter uses (2-character
  gate, debounced). Picking a project there re-scopes the **Conductor** ring
  and the **Parent** search to it; changing or editing the pick clears both,
  the same way a cross-project assignment is rejected server-side. The picked
  project is what both submit rows carry forward. Without a project — none in scope and none picked —
  `[ Create directly ]` refuses with `no project selected — pick one above to
  create directly` and writes nothing. It needs a **title** for the same kind
  of reason, and refuses an empty one the same way, before the round trip:
  `title is required — type one, or hand it to the agent`.
  `bb_ticket.title` is required server-side, so the popup already knows what
  the server would answer. The project precondition applies to both rows alike
  (BB-664): the agent row refuses the same way (`no project selected — pick
  one above to hand this to the agent`) when nothing resolved a project, rather
  than guessing one. The title precondition is the direct row's alone — the
  agent row interviews the operator for the title instead. A rejected write is
  reported in the popup, with the typed text still in it.

The **Description** soft-wraps to the popup's inner width (measured in display
columns), so a long line is readable inside the frame instead of clipped at it,
and **Labels** are read from the `label` vocabulary. When an option list
cannot be loaded the popup says so per list (`⚠ Labels could not be loaded: …`)
rather than presenting an empty one — an empty list means the read succeeded and
there is nothing to offer.

**Parent** (BB-257) is optional and scoped to the project in scope: type to
filter, `←→` to move the suggestion cursor, `Enter` to pick. It offers only the
project's **open** tickets (BB-309) — filing new work under a ticket that is
already finished is not something the form asks the operator to consider, so a
closed one is never suggested. (The ticket list's own parent *filter* is a
different question — narrowing a list by a parent that has since been closed is
legitimate — and it still offers closed tickets.) Matching is a
case-insensitive substring over `bakers.build-nnn · <title>`, so an identifier fragment
and a title fragment both work. A page of the project's most recently changed
tickets is preloaded when the popup opens and re-queried (debounced) as you
type. Five suggestions are drawn at once, and whatever that render window
leaves out of the matches it has is counted as `+N more — narrow the search` —
a statement about the popup, not about the server. The server is a second,
separate limit: a page is capped at 50 rows by Drupal's `OffsetPage::SIZE_MAX`,
so a bag that came back full may itself be a truncated answer, and the field
says `more may exist — narrow the search` whenever it is at the cap and the
counter has nothing left to report. Both notes exist for one reason: never
imply the list is complete.
Opened from a **root screen** there is no project in scope and the field says
`(no project context — open a project to pick a parent)`. A picked parent
travels in the spec as `parent: {id, identifier, title}` and becomes the created
ticket's `parent_id`, from which the server derives `base_branch`.

On the **agent** submit the collected fields are written to a temp JSON spec and
passed to the agent via `$BB_NEW_TICKET_INPUT` (never on the command line —
PTY-4096 safe); the agent adopts them and only asks for what's missing. Each
agent record carries a short **name** (the title, else the description's first
line, shown in the list so you can tell which ticket), the pre-filled inputs, and
an `isNew` flag.
The agent's base prompt defaults to a built-in but can be overridden by config
(`ticket_create_prompt`). Which agent runs is config-driven too: the launcher
hands the resolved agents (an object keyed by id) to an optional
`ticketAgent(ctx)` hook in the conductor config, where `ctx.isNew` lets you route
a new-ticket create to a different agent than other work:

```js
// conductor.config.js
ticketAgent: ({ isNew, agents }) => (isNew ? agents.claude : agents.codex),
```

On submit each agent becomes a **split pane in its project's durable
`bakers-ticket-agents:<project>` tab**, labelled `ticket-create:<project>:<sessionId>`,
and is zoomed full-screen so it stays readable. The tab is **per project**, so the
`Ticket-Agents` screen shows only the agents of the project you are in — never
another project's. Multiple agents run concurrently (more splits in that tab). In
`Ticket-Agents`, `Enter` **switches to** the selected agent (zoom full-screen +
focus), `z` restores the **tiled overview** of all agents, `x` closes one. A rapid
double-submit is debounced.

## herdr as the durable backend

The TUI drives agents at the level of **intent**, never mechanics. It says
`launch / list / focus / hide / kill` keyed by an opaque `group` (the project)
and an agent `id` — it never names panes, tabs, splits or zoom. The renderer owns
this seam itself: the prompt-level **`TuiAgentService`** contract lives in this
package (`src/types.ts`), NOT in `@bakers-build/core` (BB-194 — core is the
conductor engine contract, not a TUI concern). `@bakers-build/addon-herdr` provides
the impl (`herdrAgentHost`, typed against its own local host interface + exposed
on `HerdrWorkspace.agentHost`) and owns the whole layout policy: one durable tab
per group (`bakers-agents:<group>`), a new agent splits off a live pane, the shown
agent is zoomed, hide un-zooms + returns to the caller. Agents survive a TUI
restart — `list(group)` rediscovers them from the live tab, so the
`Ticket-Agents` screen is exactly the host's live set. The renderer never imports
herdr; the conductor `bakers ui` entry injects the adapted host.

Why intent, not the earlier pane-level host: we don't know what the next herdr
does. This contract survives a different pane model or layout engine unchanged —
only `herdrAgentHost` swaps (and, when herdr grows real `herdr agent …` verbs, it
shrinks further). The conductor launcher only adapts the prompt→command step
(config picks the agent binary) and forwards to `agentHost`; no herdr CLI in the
conductor, none in this plugin (it consumes only `TuiAgentService`, `src/types.ts`).

## Home-rooted launcher — `runBbUi(opts)`

This package owns the dropsh-tui invocation (BB-194 AC-4). `runBbUi` builds
the dropsh program (renderer + the connection's auth plugins), runs the trivial
`--format tui search bb_project` seed (the renderer discards it and boots
My work), and injects the given agent host into the
renderer's `services`. It is **herdr-agnostic** (the `agents` impl is injected,
never imported) and **dropsh-decoupled** (dropsh's `buildProgram` is injected, so
this package needs no `dropsh` dependency — AC-5):

```ts
import { runBbUi } from '@bakers-build/addon-bakers-ui';
import { buildProgram } from 'dropsh';

await runBbUi({
  connection,          // { baseUrl, jsonapiPrefix?, authPlugins, configPath? }
  cwd,                 // repo/home root the launched agents run in
  project,             // default project (opaque group), from the registry
  agents,              // herdr-backed host, already adapted prompt→command
  currentUser,         // preselected new-ticket assignee
  ownConductorId,
  buildProgram,        // dropsh's real buildProgram, injected
  // renderer,         // optional override; defaults to this package's plugin
});
```

The `bakers ui` command is a **thin, home-rooted entry** (AC-1): it reads the
user-global machine context (connection + identity) and the conductor registry
(default project) — NOT a project `conductor.config.js` — builds a herdr agent
host, adapts prompt→command, and delegates to `runBbUi`. That one composition
point is the only wiring left in the command.

**Which dropsh config it reads** (`connection.configPath` → `$DROPSH_CONFIG`):

1. A user-authored **`~/.bakers/conductor.config.js`** wins, if present — a real
   home-level cockpit config (own plugins / scope / project).
2. Otherwise the **shipped fallback** `@bakers-build/conductor/home.dropsh.config.js`
   is used. It carries no connection data: it `import`s `@dropsh/plugin-oauth2`
   by name (resolving from the conductor install, not `$HOME`) and reads the
   machine context named by `$BB_MACHINE_CONTEXT` (set by the entry) for
   base_url + credentials. Nothing is generated or written at runtime.

The entry pins **no** read profile, and sets `$DROPSH_AUTH_PROFILE` nowhere
(BB-391). It used to pin one, because a connection declared two profiles
differing only by OAuth scope and the cockpit's owner-gated
`bb_conductor`/`bb_run` reads came back empty under the wrong one. BB-359
moved capability onto the OG rank an identity holds in its workspace, so both
resolved to the same role; a v3 connection declares ONE provider marked
`default: true` and there is nothing to choose between. dropsh stays unmodified —
only its public `buildProgram` + config seam are used (AC-5).

## Testing

Vitest covers the pure modules (liveness/status derivation, the dropsh reads, the
create-launch builder, the seven `ListTable` configurations — the Ticket-Agents
list among them, which is where `Agent/Component/agent-list/` went in BB-345 —
and the ticket/run render blocks)
and, under `tests/Kernel/`, boots the **real** `runTicketTui` over a fake TTY pair
at 120×40 — emitting real keystrokes and real SGR mouse reports and asserting on
the real rendered transcript, including the row geometry at several widths against
an independent width oracle. Run it from the monorepo root:

```bash
cd bakers-cli && npx vitest run addons/bakers-ui/tests
```

`pnpm --filter @bakers-build/addon-bakers-ui test` runs the same suite (BB-309). It
did **not** until then: the package declared no `test` script, so a filtered run
selected nothing, printed nothing and exited 0 — every gate ever stated in that
form for this addon had been passing by running no tests at all. Judge either
form by its **exit code**; `--reporter=basic` no longer exists in vitest 4, so a
grep verdict goes silently blind.

`@bakers-build/addon-herdr` covers the `herdrAgentHost` layout policy + command
construction (mocked exec). The interactive PTY walk — start / hide / re-open /
parallel / errors, and the click/scroll walk over a real emulator — is
spec-designated **manual acceptance** (a terminal, not a browser, so no
Playwright-BDD; same as BB-175).
