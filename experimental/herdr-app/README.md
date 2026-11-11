# bakers in Herdr Desktop

Ticket editing inside the [Herdr Desktop app](https://herdr.dev) (`herdr-app`), next to the terminals where the agents run. Like the [PM bot](../pm-bot/README.md), this experimental integration has no dedicated Bakers addon: it works with bakers.build as it is today and marks in its own screens what bakers.build would have to add (a dashed **needs API** chip).

It is one Herdr mod, `bakers`, a layout of its own and a copy of Herdr's tab bar. Each thing has one home:

| Region | What bakers puts there |
|---|---|
| Rail | Herdr's logo, **Spaces** (Herdr's sidebar) and the **bakers** button with the Needs me count; a click shows the Tickets tab with Needs me, a right click offers New ticket, Go to ticket and the sidebar |
| Left sidebar (`cmd-B`, hidden at first) | Under Herdr's Spaces and Agents: the project and the views Needs me, Mine, Open by state (one row per state), Recently closed, each with its count; at the foot **Conductors 3 of 4 online**, the conductor list, read only |
| Tab bar | The **Tickets** tab (always tab 1, with the Needs me count), one tab per open ticket named `SHOP-41 working` (`closed` once done or cancelled), the preview tab in italics, a dot on a ticket tab that needs you, and the **Ticket** button for the panel |
| Main | The Tickets tab: the rows of a view (ticket, title, why it needs you or its state, agent, age), a view menu, a filter, a list menu and **New ticket**. A ticket tab: the ticket as a document, with its state menu, the Needs you card, the description, the comments thread and the composer |
| Right panel (Ticket button, `cmd-shift-T`) | The context of the focused ticket: **Agent and conductor** (where it runs or would run, and Run on, Move to, Stop dispatch, Show agent, Cancel run), properties (type, recipe, labels, frozen, branch, parent, links; assignee and reviewers need API), activity, runs |
| Status bar | One bakers item beside Herdr's: project, Needs me count, "updated 1m ago" or "bakers offline"; a click shows the Tickets tab |
| Over the window | Dialogs for every consequence (change state, freeze, cancel run, run on, move to, stop dispatch, add machine, new ticket), popups (state menu, type and recipe, labels, conductor picker, Go to ticket) and a toast when a ticket starts to need you |

**Enter** in the list opens a ticket in the preview tab, which the next Enter replaces; **cmd-Enter**, a double click, a double click on the tab or typing in it (edit, comment) pins it. A ticket that is already open only gets its tab selected. Every ticket tab carries its ticket in its props.

Editing never autosaves: **E** or a click turns title and description into fields, **cmd-Enter** saves, **Esc** cancels. Type, recipe and labels save when picked. State changes, freeze and every remote action ask first and name the consequence; **Esc** never changes anything.

## Keys

| Key | Where | What |
|---|---|---|
| `cmd-shift-B` | anywhere | The Tickets tab with Needs me |
| `cmd-shift-N` | anywhere | New ticket (the project of the Tickets tab, the focused ticket as parent) |
| `cmd-shift-O` | anywhere | Go to ticket by identifier or title |
| `cmd-shift-T` | anywhere | Ticket panel on or off |
| up, down, Enter, cmd-Enter, N, /, R, Esc | Tickets tab | Move, preview, pin, new ticket, filter, refresh, clear the filter |
| up, down, E, A, S, C, R, G, cmd-Enter, Esc | a ticket tab | Walk the document, edit, act on the Needs you card (Answer or Approve plan), state menu, composer, Run on or Move to, Show agent, save or send, back |

The installer binds the four global keys only where `keys.json` leaves them free. Herdr's own keys apply to ticket tabs too: `cmd-1..9`, `ctrl-Tab`, `cmd-W`.

## Remote: where a ticket runs

The panel's **Agent and conductor** section knows six states: no run and no conductor, running here, running on another machine of yours, running on a teammate's machine, waiting for an offline conductor, and waiting for a full one (derived: there is no queue field). **Run on...** and **Move to...** open the conductor picker; a pick always leads to a dialog. Move to is two calls (cancel, then start); when the start fails, the section says the run is cancelled and offers Run on again.

**Show agent** puts the run's terminal right of the focused pane (`terminal.keep`): **closing that pane ends the run**, so put it away with the pane menu's Send back. For your machine that Herdr does not know yet, it first asks to add it (`hc machine add <ssh target> --name <machine_id>`). A teammate's machine keeps the button visible but disabled, with the reason.

Which machine is this computer comes from `machine_id` in `~/.bakers/machine.config.js` (read only). Machines, load and connection URLs need `bakers_machine_list` and the `machine` field of `conductor_list`; while the server lacks them, the views say **needs API** and Show agent works only for terminals Herdr already shows.

## Install

Open the Herdr app once, then from this repository:

```sh
node experimental/herdr-app/install.js --dry-run   # what it would do
node experimental/herdr-app/install.js
node experimental/herdr-app/install.js --from my-layout   # start from your own layout instead of Herdr's main
```

The installer replaces `~/.config/herdr-app/mods/bakers/` with this mod (`HERDR_APP_HOME` picks another home), writes `mods/bakers-tabs/` and `layouts/bakers.json` from Herdr's `main` (or `--from`): the rail first, Herdr's sidebar hidden with the bakers views under Spaces and Agents, the ticket in the right panel, the bakers item beside the status bar, the tab bar swapped for `bakers-tabs`. It binds the keys that are free, checks both mods with `herdr-app check` and switches the window to the `bakers` layout. A layout or `keys.json` it replaces is kept as `<name>.bak-<time>`. Run it again after a change here or a Herdr update; `ctrl-shift-l` cycles back to another layout.

`bakers` must be on the `PATH` of your login shell and logged in (`bakers tools tool_api__bakers_project_list` answers). The first time, pick the project; the choice is remembered.

| File | What it is |
|---|---|
| `install.js`, `lib/install.js` | The installer and its pure parts: the layout, the tab bar, the keys |
| `mods/bakers/main.js` | Picks the view from `props().view`; opened by `mod.open:bakers` it shows the Tickets tab |
| `rail.js`, `sidebar.js`, `status.js`, `list.js`, `tickettab.js`, `panel.js` | The regions |
| `confirm.js`, `newticket.js`, `menu.js`, `labels.js`, `picker.js`, `goto.js` | Dialogs and popups |
| `store.js` | The project's data, loaded once and shared by every view of the mod |
| `derive.js`, `remote.js`, `flows.js` | Pure logic: views, rows and tabs; where a ticket runs; what every dialog says and which calls every write makes |
| `bakers.js` | bakers.build through the `bakers` CLI (`bakers tools tool_api__bakers_<name> --data <json>`) with your own auth profile |
| `open.js`, `actions.js`, `ui.js` | Herdr commands, shared actions and UI pieces |

Shared state holds only identifiers, counts and timestamps (`bakers.project`, `bakers.view`, `bakers.selected`, `bakers.ticket`, `bakers.preview`, `bakers.needs`, `bakers.needing`, `bakers.closed`, `bakers.updated`); ticket content stays in the mod's memory. The rail refreshes the project every 60 s and takes the global keys as mod commands (`bakers.new`, `bakers.goto`, `bakers.panel`, `bakers.pin`, `bakers.open:<identifier>`, `bakers.preview:<identifier>`, `bakers.view:<view>`).

## What bakers.build would have to add

1. **Mine, assignee, reviewers**: no tool returns or sets them (only `ticket_create` takes an e-mail).
2. **Allowed transitions**: no tool names a workflow's states; the state menu shows all, the server refuses.
3. **A project's workflow** for `ticket_create`: taken from one of its tickets.
4. **A ticket's web URL**: `ticket_read` has none, so Open on web is disabled.
5. **Needs me without a run** is derived (frozen plus the label Question or technical problem, a plan comment without a run).
6. **Description revisions**: saving replaces the whole text; an agent's edit meanwhile is lost.
7. **Answering** is two calls (comment, then unfreeze and remove the label), not atomic.
8. **Lists**: `ticket_list` has no type, time, conductor or run, so each open ticket asks for its runs.
9. **Recently closed**: `ticket_list` has no closing date.
10. **Re-plan protocol**: whether the agent picks up Request changes as a comment.
11. **Move to** is two calls (`run_cancel`, then `ticket_update conductor`).
12. **Machines**: `bakers_machine_list` and the `machine` field are on `next`, not deployed; only your own machines have a URL and load.
13. **Queued** is derived; there is no queue field or position. An offline conductor has no "since".
14. **Types and recipes**: no tool lists them or a project's default recipe; the mod offers bakers' own.

## Tests

```sh
node --test 'experimental/herdr-app/test/*.test.js'
```

Every write is tested against a fake client (`test/flows.test.js`); none of the tests reaches bakers.build. The views are checked with `herdr-app check` and by hand in the app.
