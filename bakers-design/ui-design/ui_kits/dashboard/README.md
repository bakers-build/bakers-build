# bakers.build — UI Kit (Dashboard product)

High-fidelity recreations of the live bakers.build monitoring surfaces. These are the source screens the design system was extracted from — faithful product views, not storybooks.

- `index.html` — **Dashboard** (`/admin/bakers/dashboard`): the global filter bar + Aktive Tickets table + workflow board + Nodes/Billing. One level, querystring-driven.
- `ticket.html` — **Ticket detail**: read-only ticket with run/lease timeline; links back to the board.
- `login.html` — **Login**: Gin-native sign-in.

## Building new bakers.build surfaces
Compose the primitives in `../../components/` (AppHeader, FilterBar, SectionShell, TicketRow, BoardColumn, BoardCard, StatusPill, LeaseBadge, …) and link the root `../../styles.css` for tokens + `bakers-*` classes. These recreation files carry their own inline styles because they predate the extracted token/component layer; new work should not — it should ride the shipped CSS.
