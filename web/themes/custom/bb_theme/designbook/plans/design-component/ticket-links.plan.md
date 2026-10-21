# Plan: design-component

## Params
component_id: ticket_links
reference_url: ""

## Decisions
Component: ticket_links
Group: Data Display
Namespace: bb_theme (→ bb_theme:ticket_links)
Variants: default only
Slots: none
Props:
- links (array, required) — each item: { url: string, title: string, kind: enum(mr|branch|ci|doc) }
Render: a compact vertical list; per link a kind icon (mr/branch/ci/doc) + the link title as an external anchor (target=_blank, rel=noopener). Empty `links` (missing or `[]`) renders nothing — no wrapper, no empty section (clean empty-state).
Visual language: Gin-native dark, token-styled (bg-surface / text / text-link / border tokens), no new tokens. Kind icons are inline SVGs owned by the component (moved out of the PHP formatter into the SDC — theme owns presentation).
Story: ticket_links.default.story.yml — one mr + one branch + one ci + one doc link, so the preview shows all four kind icons + external anchors in the dark theme.

## Notes
Approach C (user-approved): the presentation lives in a designbook-designed SDC, NOT in the PHP formatter markup.
- The kind-icon SVGs currently hardcoded in `BbTypedLinkFormatter::ICONS` move INTO `ticket_links.twig` (one inline SVG per kind: mr=merge, branch=branch, ci=play/check, doc=file). The component is the single source of the link presentation.
- `BbTypedLinkFormatter` is rewired to be a thin data-mapper: instead of emitting per-item containers, it builds ONE `#type: component` render of `bb_theme:ticket_links`, passing the field items as the `links` prop array `[{url, title, kind}]` (kind read from `options.bakers.kind`, derived at save by BbTicket::preSave via `LinkKind::fromUri`; missing/invalid → doc). Empty field → return `[]` so the slot renders nothing.
- Kind derivation stays server-side (`LinkKind`), unchanged. The SDC receives already-classified kinds; it never parses URIs.
- Wiring into the ticket detail is a SEPARATE design-entity concern (see the design-entity plan `bakers-ticket-full-links`): add a `links` slot to `ticket_detail`, render it inside a `section` primitive ("Links" eyebrow) like Runs/Activity, and map the `links` field into that slot in `core.entity_view_display.bb_ticket.bb_ticket.full.yml` via the (rewired) `bb_typed_link` formatter. The empty-state is doubly safe: formatter returns `[]` AND ticket_detail guards `{% if links %}`.
- Two-path config sync (no drift): the `full.yml` change goes into BOTH `config/sync/` (server CIM) AND `web/modules/custom/bb_core/modules/bb_dashboard/config/optional/` (the recipe imports it by name via `recipes/bb_seed/recipe.yml`). There is no `recipes/bakers/config/**` copy of this display.
- data-model.yml: add a `links` field (type link/array, multiple) to `bb_ticket.bb_ticket` so the design-entity sample-data/story can feed the slot.
- Build nothing in spec — this plan is the implementation record for the coding state (`debo design-component --from-plan ticket-links`).
