# Plan: design-entity

## Params
entity_type: bb_ticket
bundle: bb_ticket
view_mode: full
reference_url: ""

## Decisions
Entity: bb_ticket.bb_ticket
View-mode: full (template: field-map)
Section id: bb_ticket
Scope: extend the EXISTING bb_ticket/full mapping — add a Links region. No re-plan of the hero/state-flow/description/properties/Runs/Sub-tickets/Activity sections (already designed in `bakers-ticket-full.plan`).
New components: none in this workflow. The Links region renders through `bb_theme:ticket_links`, designed in the sibling plan `plans/design-component/ticket-links.plan.md` (built in coding via `debo design-component --from-plan ticket-links`).
Entity mappings: bb_ticket.bb_ticket / full — ROOT (the only mapping touched; the child closure comments/runs/sub_tickets is unchanged).
Sample data: bb_ticket.bb_ticket — add a `links` field to the ticket sample record(s) (one mr + one branch + one ci + one doc) so the Links region renders in the standalone entity preview; plus a ticket with empty `links` to prove the empty-state (no region).

## Notes
This is the SYNC/wiring half of the ticket (Approach C). The ticket_links SDC is the presentation; this plan wires it into the ticket detail and the Drupal entity view display.

Concrete build steps for coding:
1. ticket_detail component gains a `links` slot:
   - `components/ticket_detail/ticket_detail.component.yml` → add `slots.links` (title "Links", description "Ticket links (MR/branch/CI/doc) rendered by bb_theme:ticket_links").
   - `components/ticket_detail/ticket_detail.twig` → after the properties list / near Runs, add `{% if links %}` wrapping the shared `bb_theme:section` primitive (header 'Links', header_style 'eyebrow', columns 1, region_attributes) with `{% block content %}{{ links }}{% endblock %}`. Empty slot → `{% if links %}` false → no region (clean empty-state).
   - `components/ticket_detail/ticket_detail.default.story.yml` → add a `links` slot sample so the ticket_detail story previews the region.
2. Entity view display mapping — map the `links` field into the ticket_detail `links` slot, rendered by the (rewired) `bb_typed_link` formatter:
   - `slots.links.sources[0]` = `field_formatter:bb_ticket:bb_ticket:links`, source type `bb_typed_link`, node_id `links_list`.
3. Two-path config (NO drift — both files identical):
   - `config/sync/core.entity_view_display.bb_ticket.bb_ticket.full.yml` (server CIM path).
   - `web/modules/custom/bb_core/modules/bb_dashboard/config/optional/core.entity_view_display.bb_ticket.bb_ticket.full.yml` (recipe imports it by name via `recipes/bb_seed/recipe.yml`; there is NO `recipes/bakers/config/**` copy of this display).
4. data-model.yml: add a `links` field (type link, multiple: true) to `bb_ticket.bb_ticket` so design-entity sample-data/story can feed the slot.
5. Regression tests (Kernel/Functional):
   - ticket with links → full view renders the ticket_links anchors (assert data-component-id `bb_theme:ticket_links` + one anchor per link + kind marker).
   - empty links → NO Links region in the full render (empty-state).
   - Update `BbTypedLinkFormatterTest` for the rewired formatter (now renders one `#type: component` bb_theme:ticket_links, not per-item containers).

Kind derivation is untouched: `BbTicket::preSave` writes `options.bakers.kind` via `LinkKind::fromUri` at save; the formatter reads it and passes it as the `kind` prop. The SDC never parses URIs.
