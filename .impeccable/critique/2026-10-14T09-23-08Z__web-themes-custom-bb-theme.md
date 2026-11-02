---
target: app theme before the rename (now bb_theme), complete
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:web/themes/custom/bb_theme"
timestamp: 2026-10-14T09-23-08Z
slug: web-themes-custom-bb-theme
---
# App theme before the rename (now bb_theme) — critique + audit (2026-10-14)
Method: dual-agent (A: design review · B: detector+browser) + separate technical audit agent.

## Design Health (Nielsen) 23/40 — Acceptable
1 Status 3 · 2 Real world 2 (ISO timestamps, "4210s", "Pipeline passed" + "2 failed") · 3 Control 3 · 4 Consistency 2 (New ticket vs +, board columns ≠ workflow states, nav highlight) · 5 Error prevention 3 · 6 Recognition 2 (row edge colours w/o legend, "?" avatar, unlabeled title search) · 7 Efficiency 1 (no shortcuts, no bulk, manual Save) · 8 Minimalist 3 · 9 Error recovery 2 (failed run without retry) · 10 Help 2

## Audit 13/20 — Acceptable
A11y 2 · Performance 3 · Theming 3 · Responsive 2 · Integrity 3. P0 0 · P1 5 · P2 8 · P3 3.

## Priority issues
- [P1] Contrast: neutral badge text-faint/surface-3 4.17 light / 2.56 dark; state-* colours as text (1.5–3.2); form_label uses text-state-offline (3.88); dark text-light on surface-2 3.66, link 4.32 → colorize
- [P1] Failed/claimed runs: no salience, no recovery action → harden
- [P1] Focus on inputs/pickers only 1px border change (1.34:1) → harden
- [P1] Machine-formatted data (ISO, seconds) → clarify
- [P1] Mobile: ticket detail 450px overflow at 390, board cut, filters push list below fold, targets <24px → adapt
- [P2] Power-user efficiency (shortcuts, j/k, autosave) → optimize
- [P2] Board columns not by workflow state → layout
- [P2] Drift: duplicated button contract, h-[30px] vs h-control, 133 arbitrary px values, dead text-h3, state-flow/event hand-rolled pills → distill/polish
- [P2] Chart.js + jQuery UI on every page → optimize
- [P2] state-flow current step colour-only, no aria-current; gate without main/heading → clarify/harden

## Detector
CLI 0 findings (105 twig, verified not skipped). Browser: low-contrast ×9 (real), side-tab ×3 + nested-cards ×6 on board-card (intentional), cream-palette (intentional).
