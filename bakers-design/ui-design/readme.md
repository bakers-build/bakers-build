# bakers.build Design System

Visual + component foundation for **bakers.build**, a ticket-driven orchestration system built on **Drupal 11**. Drupal is the control plane (tickets, workflow states, run-leases, conductor registry); distributed **Conductor** nodes claim tickets per project and spawn AI-agent sessions that do the work and write back over JSON:API. **Humans never work inside the dashboard** — they work in spawned terminal sessions; the dashboard is pure monitoring.

This design system exists so every bakers.build surface (dashboard, ticket detail, login) is assembled from ONE set of tokens and components — no screen-specific one-off values.

## Sources
- **Product screens (this project):** `bakers.build Dashboard.html`, `bakers.build Ticket.html`, `bakers.build Login.html`, `bakers.build Logo.html` — the built mockups this system was extracted from.
- **Visual style reference:** the **keytec** design system (`e6dfec20-77c7-4e51-8891-75dbfd979d30`) — bakers.build borrows its four state hexes and its ocean-blue link/accent color from it; **GitLab** is the second reference, for clean/quiet operational-SaaS density at scale (hairline borders, small radius, restrained shadows).
- **Runtime target:** Drupal 11 · Twig templates · **Gin 5** admin theme (light) · **htmx** fragment polling · `Drupal.behaviors`. No build framework in production; this token/utility set compiles into a lean Gin sub-theme library.

## The core idea
**Light, "keytec × GitLab hybrid."** Neutral chrome, type, radii and surfaces come from Gin (mapped to `--gin-*` tokens, so Light/Dark and accent-color changes flow through automatically) — currently tuned for Gin's light mode. **bakers.build introduces exactly four state colors** (`--bakers-*`, seeded from keytec) plus one deliberate brand-accent device (`--border-strong`, 2px solid black) used sparingly: the app-header rule, the primary CTA button, alert/empty-state cards — never on a repeating element (a table row, a board card, a pill). Everything dense/repeating (rows, cards, pills) stays quiet: 1px hairline borders, no shadow by default. State is always encoded **doubly** — a left accent edge on the row/card **plus** a status dot/pill — never color alone, so it survives reduced color vision. No emoji; attention/needs_input markers are drawn as SVG.

## CONTENT FUNDAMENTALS
- **Language:** German for UI copy; English only for technical field/state names (`needs_input`, `claim_owner`, `coding`). Terms from the spec are used verbatim: Ticket, Conductor, Run / Claim-Lease, `needs_input`, `attention`, Assignee.
- **Tone:** precise, matter-of-fact, operational. No hype, no exclamation, no marketing voice. Labels are nouns (`Aktive Tickets`, `Nodes`, `Abrechnung`), section labels are UPPERCASE.
- **Casing:** "keytec" (the agency) is always all-lowercase; "Drupal" keeps its capital. bakers.build is the product name in caps.
- **Person:** the dashboard addresses the operator directly and collegially (`Meine`, `Du bist dran`) inside the tool.
- **Emoji:** none. Ornament and signifiers are SVG glyphs at the brand's 2px stroke weight.
- **Numbers:** monospace with tabular figures for IDs, node names, durations, token counts, querystrings (e.g. `srv01-bakers · GL-138 · 4:32 · 1,2M`).

## VISUAL FOUNDATIONS
- **Colors:** light neutral ladder `#F6F6F2` (canvas) → `#FFFFFF` (app/layer) → `#FAFAF7` (layer-2) → `#F1F0EA` (layer-3); hairline borders `#E9E7E0` (soft divider) / `#D6D3CA` (visible border, buttons/chips); text `#14171A / #5B6169 / #6B7078`; keytec-ocean accent `#494FE5`; brand-accent line `#000000` (2px, sparse use only). State: `#FF4E42` critical (needs_input+unassigned), `#FFC024` waiting (needs_input/attention/stale), `#4BB9AE` healthy (running/online), `#8197F8` lease/ownership (neutral), `#707888` idle/offline — unchanged from the original keytec-seeded hues. Fills use ~13–15% alpha tints (these render correctly over the light surfaces without adjustment). Pill/tag/label **text** on those tints uses darker "ink" variants (`--bakers-*-ink`: `#A5301F`, `#7A5600`, `#1F6B63`, `#3B4BA8`) — the raw hues above are too light to pass WCAG AA as text color on their own tint; the ink variants all clear ≥5.4:1.
- **Type:** system-ui sans + ui-monospace (Satoshi self-hosting is planned but not yet wired — see `tokens/typography.css`). Compact scale: 26 title / 18 screen-title / 11.5 UPPERCASE section / 13 body / 12.5 mono / 11 faint. Density is deliberately tight — the real use case is a laptop half-screen next to a terminal.
- **Spacing & radii:** a single consolidated radius (4px) everywhere — cards, buttons, pills, dropdowns; 34px compact table rows; 14px section padding and inter-fragment gap.
- **Backgrounds:** flat solid surfaces only. No gradients (except the tiny brand-mark chip, which stays a fixed dark asset regardless of theme), no glass/blur, no ambient lighting.
- **Borders & cards:** 1px hairline borders by default. The signature 2px solid-black rule is reserved for brand-accent moments (header bottom rule, primary CTA border, alert/empty-state card border) — never repeated across dense/list content. Cards carry no shadow by default; elevation is reserved for the filter dropdown (soft `0 4px 12px rgba(20,23,26,.10)`) and the primary CTA button (hard offset `4px 4px 0 0 #000`, collapsing to `2px 2px` on hover — the one deliberate keytec-style flourish, scaled down from the brand's 6px/6px so it doesn't overpower a dense UI).
- **State encoding:** 3px left accent edge on rows/board-cards + a dot (`.bakers-dot`) or pill (`.bakers-pill`). Lease/ownership uses an ocean badge (`.bakers-lease`), outlined when it's "mine".
- **Animation:** minimal. The healthy dot pulses (2.4s, disabled under `prefers-reduced-motion`); the auto-refresh ring counts down over 15s. Fragment refresh dims content to `opacity:.55` for 120ms rather than flashing. No bounces, no spring easing.
- **Hover / focus:** hover lifts a dark-alpha tint (`rgba(20,23,26,.03–.04)`, not the old white-alpha which only worked on a dark background) and firms the border toward `#BDB8AA`; links/active nav use the ocean accent. Focus is Gin's own ring (accessibility, not decoration).

## ICONOGRAPHY
- Custom inline **SVG line icons** at ~2px stroke, drawn to match Gin's weight (dashboard grid, board columns, node stack, billing cylinder, lock=lease, pause=attention, warning-triangle=needs_input/unassigned). No icon-font, no Lucide/Heroicons/Material, no emoji. Unchanged from the dark version — icons use `currentColor`/the state hexes directly and adapt automatically once the surrounding text-color tokens are light.
- The **bakers.build brand mark** is a marionette-mobile: a conductor bar suspending three balanced agent tokens in the state colors (teal circle, ocean triangle, sun square). It sits inside a fixed dark gradient chip wherever it appears as a logo (the header, the login screen) — that chip and its internal line color (`#E8EAEF`, hardcoded) do **not** re-theme with the page; only the standalone specimen version (no chip, e.g. the design-system brand section) reads the live `--gin-text` token. See `bakers.build Logo.html` / the Brand specimen card.
- Partner/status glyphs (online ●, stale ○, ownership lock) are drawn in the same grammar.

## Font note
No custom webfonts are shipped yet — bakers.build rides the OS `system-ui` and `ui-monospace` stacks for now (zero load cost). Satoshi (the keytec house face) is the intended self-hosted upgrade — `tokens/typography.css` carries a `TODO(font)` note; it was deferred because transferring the TTF files through this tool's 256 KiB `get_file` cap needs a different path than a straight copy. If a branded face is wired in later, add the `@font-face` block in `tokens/typography.css` and it will ship automatically.

## Index — manifest
- `styles.css` — global entry (link this). `@import`s every token file + `components.css`.
- `tokens/` — `colors.css` (light neutral chrome), `state.css` (the four bakers.build hues + their `-ink` text variants), `typography.css`, `spacing.css` (single 4px radius), `elevation.css` (the two brand-accent shadows), `motion.css` (keyframes).
- `components.css` — shipped component classes (prefix `bakers-`).
- `components/` — React primitives, grouped: `status/` (StatusDot, StatusPill, LeaseBadge), `core/` (Button, Avatar, PrioTag, Tag), `layout/` (SectionShell), `board/` (BoardCard, BoardColumn), `navigation/` (AppHeader, FilterBar), `data/` (TicketRow).
- `guidelines/` — foundation specimen cards (Colors, State, Type, Spacing, Brand).
- `ui_kits/dashboard/` — full-screen recreations pointing at the built product screens.
- `SKILL.md` — Agent-Skill manifest.
