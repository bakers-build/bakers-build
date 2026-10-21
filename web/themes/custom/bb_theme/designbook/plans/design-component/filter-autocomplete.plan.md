# Plan: design-component

## Params
component_id: filter_autocomplete
reference_url: (none)

## Decisions
Component: filter_autocomplete
Group: Navigation
Description: Single-select entity-reference autocomplete control for the dashboard filter bar. The user types into a text input; suggestions come from a Drupal core `entity_reference` autocomplete endpoint. Selecting a suggestion extracts the entity id, writes it to a scalar query param, and fires `refresh-dashboard` on `document.body` (same htmx contract the existing multiselect-dropdown / mine toggle use). A plain typed value with no selection is a no-JS-degraded submit fallback.
Variants: default only
Props:
  - caption (string) — leading label shown before the control (e.g. "Projekt", "Assignee", "Conductor")
  - name (string) — scalar query-param key emitted on select (e.g. `project`, `assignee`, `conductor`)
  - autocomplete_path (string) — Drupal core entity_reference autocomplete endpoint URL (e.g. `/entity_reference_autocomplete/bb_project/default/...`)
  - value (string) — current selected entity id (drives the hidden scalar param on initial render)
  - value_label (string) — current selection display text (pre-fills the visible input)
  - placeholder (string) — input placeholder text
Slots: none
Contract binding: root carries `data-component-id="bb_theme:filter-autocomplete"` (ui_patterns emits it); the visible text input + hidden scalar `<input name="{{ name }}">` are the deliberate data-bound elements Playwright steps target — never utility/Tailwind classes.
JS behavior: small vanilla behavior (js-behavior blueprint) — on autocomplete select, parse the `(id)` suffix core emits, set the hidden scalar input's value, then `htmx.trigger(document.body, 'refresh-dashboard')`. No dependency beyond Drupal core `autocomplete` + existing htmx.

## Notes
Net-new UI artifact for BB-81 dashboard filter bar. Replaces the current project/conductor `multiselect-dropdown` (multi-select) with single-select autocomplete per the ticket decision (single-select per filter, AND across filters). The ticket-view surface reuses the core Views `widget: autocomplete` (config-only, no SDC) — this component is the dashboard-side counterpart giving identical UX (Architecture A). Built in the coding state via `debo design-component --from-plan filter-autocomplete`; build nothing in spec.
