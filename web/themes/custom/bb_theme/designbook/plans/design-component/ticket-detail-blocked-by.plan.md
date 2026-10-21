# Plan: design-component

## Params
component: ticket_detail
reference_dir:

## Decisions
Component: ticket_detail (existing, modify)
Group: Data Display
Change: add a "Blocked by" section that mirrors the existing sub_tickets section — a section primitive (header_style: eyebrow, columns 1) wrapping a compact ticket-row teaser table, placed directly before the sub_tickets section (blockers gate this ticket; children flow from it)
New slot: blocked_by — child tickets referenced by bb_ticket.blocked_by, each rendered as the shared ticket-row teaser (via entity_reference_entity_view teaser), same compact column-hiding as sub_tickets (`[&_td:nth-child(3,5,7,9)]:hidden` → keep identifier · title · state · run-status · assignee)
State badge: reused as-is — ticket-row teaser already renders `bb_theme:badge` variant=state from the blocker's own workflow state, so state is live per blocker; no new state prop on ticket_detail
OPEN vs RESOLVED distinction: resolved blockers (terminal state done/cancelled) are muted (opacity + line-through identifier); open blockers full-strength. Chosen treatment = mute resolved rows (user-confirmed)
Distinction mechanism: add a `data-state="{{ state }}"` attribute to the ticket-row `<tr>` (additive, contract-bound — mirrors ticket_detail root's existing `data-state`); the blocked_by section in ticket_detail.twig scopes CSS to that attr: `[&_tr[data-state="done"]]` / `[&_tr[data-state="cancelled"]]` → opacity-60 + `[&_.font-mono]:line-through` on the identifier cell. Scoped to the blocked_by section only — sub_tickets and the board are untouched
Empty state: section hidden entirely when no blockers (`{% if blocked_by %}`), consistent with every other ticket_detail region (links/runs/sub_tickets/comments)
Slots unchanged: links, comments, sub_tickets, runs (blocked_by is additive)
Styling: reuse the existing section primitive + ticket-row compact-table utilities; no new design tokens
Component files touched: ticket_detail.component.yml (declare blocked_by slot), ticket_detail.twig (render section + mute CSS), ticket-row.twig (add data-state attr); ticket_detail.default.story.yml gets a blocked_by slot sample for Storybook

## Notes
BB-98. Surface is the ticket entity/detail full view (bb_ticket full, bb_theme:ticket_detail), same component as the ticket-detail redesign (BB-57) and the edit-button (BB-76, see ticket-detail-edit-button.plan.md).
Data already exists: bb_ticket.blocked_by (entity_reference multi, BbBlockedByAcyclic) + hasOpenBlockers()/getBlockedByIds(); sub-tickets via parent_id (SubTicketsItemList). Only rendering (blockers) / state display needs work.
"Open" = a blocker whose own workflow state is non-terminal; "resolved" = done/cancelled. The distinction is intrinsic to each blocker's state (rendered live), NOT relative to the parent — so no per-parent computation is needed, the terminal-state CSS selector suffices. hasOpenBlockers() is not needed for rendering (it stays a validation/guard concern).
Slot→field wiring (blocked_by slot ← bb_ticket.blocked_by via entity_reference_entity_view teaser) lives in the entity view display (design-entity territory: designbook entity-mapping `bb_ticket.bb_ticket.full.jsonata` → generated `core.entity_view_display.bb_ticket.bb_ticket.full`). Must be kept in sync across all three install paths: config/sync + bb_dashboard config/optional + recipe import. Out of scope for this component plan; covered by the design-entity plan + the superpowers implementation plan.
css-generate before-hook skipped: no design-token change in this ticket, and --plan/spec builds nothing — a CSS regen here would be a no-op build action. CSS regeneration (if ever needed) happens in the coding state.
Test: functional/e2e — a ticket with one open blocker + one child renders both sections, each row carrying its state badge; resolving the blocker (advancing it to done) mutes that row.
