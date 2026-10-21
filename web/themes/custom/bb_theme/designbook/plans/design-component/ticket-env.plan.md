# Plan: design-component

## Params
component_id: bb_theme:ticket-env
reference_url:

## Decisions
Component (new): ticket_env
Group: Data Display
Slots: none
Variants: default only
Purpose: read-only masked environment-variables list embedded in the ticket_detail entity view.
Rows are data-driven via a `rows` prop: array of `{ key: string, origin: 'own' | 'inherited' }`.
Each row renders `KEY` + a masked value token `••••••` + an `own | inherited` badge.
Values are NEVER passed to the component — masking happens upstream; the component receives keys + origin only.

## Notes
BB-99. Feeds the ticket detail (bb_theme:ticket_detail via display_builder).
Upstream data prep is a PHP field formatter `bb_env_masked` (module bb_core) over two
bb_ticket fields: the stored `env_vars` (own) and the computed `effective_env_vars`
(inherited-resolved, child-wins). The formatter parses the canonical KEY=value lines, drops
every value, and emits `rows = [{key, origin}]` where origin = 'own' if the key exists in the
ticket's own env_vars else 'inherited'. Editing stays in the plain `string_textarea` widget on
the entity edit form — this component is display-only.
Wire into the `full` view display (display_builder) as a new prop/source on ticket_detail (or a
child slot), mirrored into config/sync. Accessibility: render as a definition/description list;
the mask token must not be announced as a real value. No JS. Tailwind utility classes only,
consistent with existing Data Display components (ticket_links, ticket-row).
Execute in the coding state via `debo design-component --from-plan ticket-env`.
