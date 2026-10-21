# Plan: design-entity

## Params
entity_type: bb_ticket
bundle: bb_ticket
view_mode: full
data_model: $DESIGNBOOK_DATA/data-model.yml

## Decisions
Entity: bb_ticket.bb_ticket
View-mode: full (template: field-map)
Reference screen: Claude Design project "bakers.build screens" (6dc13314-59d8-44e4-b81f-dad03ff46dfa) → `bakers.build Ticket.html` — Gin-native dark ticket detail screen, read-only monitoring.
Scope: design-entity (forward-reference closure only). Reverse/aggregate sections of the reference screen — Runs (bb_run.ticket_id), Sub-Tickets (reverse parent_id), Footprint (aggregate) — are OUT of scope here; they belong to a follow-up design-screen.
View-mode rename: bb_ticket `card` → `teaser` (data-model.yml updated).

Entity mappings (children before parent):
- bb_comment.bb_comment / full — activity-timeline event render
- bb_term.bb_labels / full — label chips
- bb_project.bb_project / full — project reference (minimal, name)
- bb_ticket.bb_ticket / teaser — parent_id + blocked_by (compact self-reference)
- bb_ticket.bb_ticket / full — ROOT (hero + state-flow + bb_rich description + properties)

New components:
- ticket_detail — root render: hero (TID · workflow badge · priority · status pill · title) + workflow state-flow ("State-Bahn": backlog→todo→spec→coding→review→human_input→done, current highlighted in state colour) + bb_rich description (prose) + properties list (state, workflow, project, priority, assignee, claim/lease, created, updated) + Footprint / Runs / Sub-tickets / Activity regions (see revision below)
- comment_event — bb_comment full render as a timeline event: author + role tag (agent/human) + timestamp + body; agent comments may carry a diff/summary card
- run_row — one bb_run as a row: run state + status dot, conductor, claim/lease badge, ticket-state-at-start, started/heartbeat (added in coding revision)
- footprint_summary — aggregate time-entry footprint: AI runtime, tokens, cost, human time, run/entry counts (added in coding revision)

Reused components (no new build): status-pill, claim-badge (lease), avatar, label (label chips), badge, status-dot, ticket-row / board-card (for the bb_ticket teaser).

section_id: bb_ticket
sample_data_bundles: bb_comment.bb_comment, bb_term.bb_labels, bb_project.bb_project, bb_ticket.bb_ticket, bb_run.bb_run

## Coding revision (review bounce 2026-07-01)
Review rejected the first pass and the user asked to pull ALL reverse/aggregate sections into the full view-mode (no follow-up design-screen). Scope now = forward closure PLUS reverse/aggregate, all inside bb_ticket/full:
- **Comment feed** (review, mandatory): ticket_detail gains an `comments` slot (Activity timeline); the full mapping emits the `comments` reference as a list of comment_event entity-nodes (`$map` + `select` by id). Fixes the forward-closure violation.
- **Runs** (reverse bb_run.ticket_id): new run_row component + bb_run/full mapping; ticket_detail `runs` slot; full mapping emits run entity-nodes via `select: $[ticket_id=…][n]`. New sample data data/bb_run.bb_run.yml (3 runs for ticket 1).
- **Sub-tickets** (reverse parent_id): ticket_detail `sub_tickets` slot; full mapping emits ticket/teaser entity-nodes via `select: $[parent_id=…][n]`. Two child records (ids 7,8) added to the ticket sample data.
- **Footprint** (aggregate): footprint_summary component; rendered inline from showcase-gated literal props in the full mapping (aggregate is not a stored field — kept out of the data-model to stay model-true).
- **priority enum gap (🔴 fixed):** ticket_detail.priority + badge.priority enums extended to p1–p5; full mapping clamps priority>5 → p5. Tickets priority 3 (ids 3,6) now render valid.
- **status vocab (🟡 aligned):** teaser human_input status → `wait` (matches full's status_variant `wait`).
Reverse sections gate on the showcase ticket (id "1") so other tickets render clean.

## Notes
Visual language: strictly Gin-native (dark), no new tokens/colours — reuse the dashboard primitives (pill · lease · dot · avatar · state accent edge · wf-badge · tag). The ticket detail is "the same app, one level deeper".
State colours (from keytec): unassigned #FF4E42, attention #FFC024, running/done #4BB9AE, lease #8197F8, offline #707888.
`assignee_user_id` → core `user` is NOT modelled in data-model.content → render inline as avatar + name (not an entity render, no mapping).
The reference screen is read-only: no mutation UI (no action buttons, no comment composer) — writes happen in Drupal forms / JSON:API outside this render.
Follow-up: a design-screen for the full /admin/bakers/ticket/{id} page composing this entity render + the bb_run list + comment feed + sub-ticket list + footprint summary + Gin shell.
