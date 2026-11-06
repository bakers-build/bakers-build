# Use the terminal UI

Open the `bakers ui` cockpit, find a ticket, read it, edit it, and keep the screen current.

**You need:** `bakers` installed and a checkout connected to bakers.build ([Install and sign in](/get-started/machine)).

1. **Start it** inside the checkout. `--print-config` names the connection that wins if you are unsure:

   ```sh
   bakers ui
   bakers ui --print-config
   ```

   The cockpit opens on **My work**, your open assigned tickets.

2. **Move between levels.** Every screen shows the tab bar of its level. `Tab` and `Shift-Tab` cycle tabs (a left click works too), `Enter` opens the selected row, `Esc` goes back, `q` quits.

   | Level | Tabs |
   |---|---|
   | Root | My work, Projects, Members (workspace leads only), Conductors |
   | Project | Overview, Work, Tickets, Runs, Conductors |
   | Ticket | Overview, Planning, History, Runs, then addon tabs such as Artifacts and Ports |

3. **Jump straight to something.** One target at most:

   ```sh
   bakers ui <identifier>            # a ticket
   bakers ui '#19'                   # the ticket created from origin issue 19
   bakers ui project:<name>          # a project
   bakers ui run:<uuid>              # a run, over its ticket's Runs tab
   bakers ui --here                  # this branch's ticket, else this repository's project
   ```

   A bare number or bare uuid is refused; prefix it with `ticket:`.

   **Find a ticket by its origin issue**, the issue it was created from. `#19` uses the repository of your projects when exactly one has one (quote it in the shell); `shop#19` names the repository by its last path segment or a unique prefix of it; an issue URL works in any spelling (`http` or `https`, with or without `/-/`, a trailing slash). Issue `19` never matches issue `190`. One ticket opens; several are listed with their `ticket:<uuid>`; an unknown or ambiguous repository prints a message naming the known ones, and two repositories sharing a last path segment need the issue URL. On every ticket list (Tickets, My work, a conductor's Assigned, a member's Tickets), `/` reads the same forms besides identifiers, a bare ticket number (`123`) and title words, and so does the search box of the web ticket list.

4. **Read a ticket.** Overview leads with the latest `summary`, then the description. Planning holds the latest `spec`, `plan` and `test`. History lists every comment, rendered as Markdown. Runs lists the runs; `Enter` opens one. `Enter` or `Space` expands the selected entry.

5. **Edit.** On a ticket press `e`: assignee, conductor, estimate and spent, parent and labels. `Ctrl+S` saves. **Cancel ticket** writes `cancelled` at once, without a confirmation step.

6. **Reload** with `R`. Anything that can write a file can do the same with `touch .bakers/ui-refresh` inside the project.

Piped output prints the target once and exits, so scripts and agents read what you would see: `bakers ui <identifier> | cat`.

**Done when:** you can open a ticket and read its latest summary. Every screen, filter and key is in the [terminal UI reference](/addons/bakers-ui/reference) and its [key reference](/addons/bakers-ui-keys).
