# Plan: design-component

## Params
component: ticket_detail
reference_dir:

## Decisions
Component: ticket_detail (existing, modify)
Group: Data Display
Change: add an access-gated Edit button in the hero `<header>` row (with the identifier/badges, before the flex-1 spacer)
New prop: edit_url (string, optional) — the off-canvas edit-form URL; button renders only `{% if edit_url %}`
Button markup: `<a class="use-ajax …" href="{{ edit_url }}" data-dialog-type="dialog.off_canvas" data-dialog-options='{"width":"40%"}'>Edit</a>` (repo off-canvas convention, cf. ticket-row.twig:34)
Library deps (component.yml): core/drupal.dialog.ajax + core/drupal.dialog.off_canvas
Slots unchanged: links, comments, sub_tickets, runs
Styling: reuse the existing pill-link utility classes from ticket-row's off-canvas link; no new tokens

## Notes
BB-76. Surface is the ticket entity/detail view (entity.bb_ticket.canonical, bb_theme), not any Views listing.
Access is server-gated via the computed edit_url field (empty when no update access) plus the edit_form route's own access handler — the button is not merely CSS-hidden.
Tray theme decision: edit_form stays admin-themed (Gin); the off_canvas @layer gotcha targets bb_theme SDC and does not bite the admin-themed core form, so no extra form styling.
Prop→entity wiring (edit_url source) lives in the entity view display (design-entity territory: core.entity_view_display.bb_ticket.bb_ticket.full) — out of scope for this component plan, covered by the superpowers implementation plan.
Full specs: docs/superpowers/specs/2026-07-07-bb-76-ticket-detail-edit-off-canvas-design.md + docs/superpowers/plans/2026-07-07-bb-76-ticket-detail-edit-off-canvas.md
