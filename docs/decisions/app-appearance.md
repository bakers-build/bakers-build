# App appearance: light and dark only, in the bakers.build CI

- **Status:** Approved by the owner 2026-11-02; ready for tickets
- **Scope:** web app (`web/themes/custom/bb_theme`). The website and `bakers ui` follow the CI contract in `.impeccable/surfaces/bakers-build-ci.md`.
- **Figma:** file `sr31HfHNWbCeNsxvXbt4wv`, page "Vorschläge & Konzepte" (67:45), section "4 · CI-Vorschlag — Board in Teig & Terminal (Light/Dark)" (550:8845). It holds the reference board (`Ist`), `CI · Light · Board` (550:8970) and `CI · Dark · Board` (550:9238). The values live in the variable collection "BB · Vorschlag CI" (modes Light and Dark). The collection "BB · semantic" and the original frames are unchanged.

## Decision

1. **Five skins become one look.** `bakers`, `harbor`, `grove`, `ember` and `iris` are removed. The app has light and dark mode only, and the default follows the system setting. Reasons:
   - one recognisable brand;
   - state colours that keep their meaning;
   - two contrast sets to maintain instead of ten.
   A workspace stands out through its logo, not through a palette.
2. **The token names stay.** Only the values change, so templates and components keep working. The token set grows by a few new tokens (see below).
3. **Light mode is flour-tinted, not beige.** The surfaces carry a slight warmth and cards stay almost white. Flour #F5EBDA stays the brand colour for the website and graphics, but the app does not use it as a surface.
4. **Butter means "waits for you", and nothing else in light mode.**
   - **Light mode:** butter appears only as a fill with rye text. It is never a dot or line on a light ground (1.5:1). Selection, the active tab and primary buttons are rye.
   - **Dark mode:** butter is also the primary colour.
5. **Avatars get their own tokens.** Today `person.twig` colours initials with state colours, so a person can look like the "unassigned" error state. New tokens `avatar-a`…`avatar-d` replace them.
6. **Type:** Spline Sans for text, Spline Sans Mono for IDs, states and numbers, and Bricolage Grotesque only for page titles.

## Tokens

The CSS name is `--color-<token>`. The values were exported from Figma on 2026-11-02.

| Token | Light | Dark |
|---|---|---|
| app | #F7F2E8 | #17120B |
| surface | #FFFDF8 | #221A11 |
| surface-2 | #F0E9DC | #2B2116 |
| surface-3 | #E6DDCD | #3A2E20 |
| input | #FFFDF8 | #1D160E |
| canvas | #F0E9DC | #17120B |
| text | #2B2116 | #F5EBDA |
| text-light / text-faint | #63584A | #BCA98D |
| title | #2B2116 | #FBF5EA |
| primary | #2B2116 | #F3CE3A |
| on-primary | #FFFFFF | #2B2116 |
| border | #E0D6C4 | #45372A |
| border-2 | #EDE6D8 | #33281C |
| control-border | #857A68 | #8E7B62 |
| link / focus-ring | #2B2116 | #F3CE3A |
| state-attention | #F3CE3A | #F3CE3A |
| state-attention-tint | #FCEFC0 | #4A3B10 |
| state-attention-ink | #5A4500 | #F8DE7A |
| **state-attention-mark** (new) | #8F6B00 | #F3CE3A |
| state-running | #8A7860 | #A8977E |
| state-running-tint | #EFE9DE | #3A2E20 |
| state-running-ink | #3D3224 | #E3D6C1 |
| state-unassigned | #C8432F | #E8644E |
| state-unassigned-tint | #F8D9D0 | #4E2018 |
| state-unassigned-ink | #8A2A1B | #F6B8A8 |
| state-lease | #B8692E | #D28A50 |
| state-lease-tint | #F3E4D7 | #4A2E18 |
| state-lease-ink | #6B3A14 | #F2C49C |
| state-offline | #8A7860 | #8E7B62 |
| state-offline-tint | #ECE6DA | #33281C |
| state-offline-ink | #4A3E30 | #CDBFA9 |
| state-ink | #2B2116 | #17120B |
| **state-review** (new) | #F4AFC0 | #F4AFC0 |
| **state-done** (new) | #BFE07A | #BFE07A |
| type-feature | #718F39 | #BFE07A |
| type-bug | #C8432F | #E8644E |
| type-chore | #B8692E | #D28A50 |
| **avatar-a** (new) | #F4AFC0 | #F4AFC0 |
| **avatar-b** (new) | #CFE69A | #BFE07A |
| **avatar-c** (new) | #EAC6A4 | #E3B48A |
| **avatar-d** (new) | #D9D3C9 | #BCB3A6 |
| chart-series-a…f | #B8692E · #718F39 · #A28317 · #DE5779 · #C8432F · #6E5D49 | #D28A50 · #BFE07A · #F3CE3A · #F4AFC0 · #E8644E · #A8977E |
| chart-flow-new | #B8692E | #D28A50 |
| chart-flow-done | #718F39 | #BFE07A |
| chart-flow-grows | #F8D9D0 | #4E2018 |
| chart-flow-shrinks | #E8F1D6 | #2F3A1A |

Light chart colours are darker than the exported values, with the same hue, so every series reaches 3:1 on `surface` and `surface-2`. The exported lime #8FB548, butter #E0B520 and rose #E88AA2 measured 2.33:1, 1.91:1 and 2.41:1 on `surface`. The owner chose this on 2026-11-02. The `chart-flow-*` tokens were not in the export; they reuse the series and state-tint values above.

Usage rules:
- `state-attention-mark` is for dots and lines that mark "waits for you".
- `state-attention` is only for the fill behind rye text.
- Crust (`state-lease`, `type-chore`) stays graphics only and is never text.

## Contrast (WCAG 2.2 AA)

I measured every text and background pair in both Figma boards. Light has 28 pairs and dark has 21, and none fails. The key token pairs:

| Pair | Light | Dark | Required |
|---|---|---|---|
| `text` on `surface` | 15.5:1 | 14.5:1 | 4.5:1 |
| `text` on `app` | 14.1:1 | 15.8:1 | 4.5:1 |
| `text-light` on `surface-2` | 5.7:1 | 6.9:1 | 4.5:1 |
| `text-light` on `app` | 6.2:1 | 8.2:1 | 4.5:1 |
| `on-primary` on `primary` | 15.8:1 | 10.3:1 | 4.5:1 |
| `state-ink` on `state-attention` | 10.3:1 | 12.1:1 | 4.5:1 |
| `state-attention-ink` on `state-attention-tint` | 8.0:1 | 8.2:1 | 4.5:1 |
| `state-unassigned-ink` on `state-unassigned-tint` | 6.5:1 | 8.0:1 | 4.5:1 |
| `state-lease-ink` on `state-lease-tint` | 7.5:1 | 7.8:1 | 4.5:1 |
| `state-running-ink` on `state-running-tint` | 10.3:1 | 9.2:1 | 4.5:1 |
| `state-offline-ink` on `state-offline-tint` | 8.4:1 | 8.0:1 | 4.5:1 |
| `state-ink` on `avatar-a` (lowest avatar) | 8.8:1 | 10.4:1 | 4.5:1 |
| `state-ink` on `state-review` | 8.8:1 | 10.4:1 | 4.5:1 |
| `state-ink` on `state-done` | 10.6:1 | 12.6:1 | 4.5:1 |
| `control-border` on `surface` | 4.1:1 | 4.2:1 | 3:1 |
| `state-attention-mark` on `surface-2` | 4.1:1 | 10.3:1 | 3:1 |
| `state-running` on `surface-2` | 3.5:1 | 5.6:1 | 3:1 |
| `state-unassigned` on `surface-2` | 4.0:1 | 4.8:1 | 3:1 |
| `state-attention` on `surface` (dot) | **1.5:1** | 11.2:1 | 3:1 |

The last row is why light mode needs `state-attention-mark`. The chart series reach at least 3:1 on `surface` and `surface-2` in both modes; `tests/contract/appearance.mjs` checks these pairs.

## Tickets

Do them in this order: 1 and 2 belong together, and 3 to 5 build on them.

1. **Remove the skins.**
   - Delete `css/tokens/appearance.src.css`.
   - Reduce the `themes` list in `js/skin.src.js` to the mode only. A saved `bakers-theme` value is ignored.
   - Make `components/mode_toggle` offer Light / Dark / System instead of the palette select.
   - Remove the skin handling from `.storybook/preview.js`, the `data-skin` observer from `components/stat-comparison/stat-comparison.src.js`, and the skin entries in `designbook/design-system/design-tokens.yml`.
   - Decide separately whether the `data-layout="cozy"` density stays. It is not a brand question.
2. **Set the CI colour values.**
   - Light values go into `css/tokens/color.src.css` and dark values into `css/tokens/color-theme-dark.src.css`, both from the table above.
   - Add the brand colours (flour, rye, butter, lime, rose, crust, muted) as primitives in `primitive-color.src.css` and alias them.
   - Mirror the changes in `design-tokens.yml`.
3. **Add the new tokens and use them.**
   - Add `state-attention-mark`, `state-review`, `state-done` and `avatar-a`…`d`.
   - In `components/person/person.twig`, point `color_map` at the avatar tokens instead of the state colours.
   - Switch the "waits for you" dots and lines to `state-attention-mark`.
   - Give the review state `state-review`.
4. **Change the type.**
   - Text uses Spline Sans and data uses Spline Sans Mono, loaded via `css/tokens/google-fonts.src.css` and `primitive-font.src.css`. Page titles use Bricolage Grotesque.
   - Spline Sans runs wider than SF Pro or system-ui. Check the dense views (tickets, time, members) for truncation.
5. **Verify.**
   - Compare all main screens in both modes against the Figma boards.
   - Measure contrast with axe or Lighthouse, including the chart series and focus rings.
   - Run the Storybook stories in Light and Dark.
6. **Figma follow-up (needs the owner's OK).** Once the code has landed, move the values from "BB · Vorschlag CI" into "BB · semantic" and delete the proposal collection. Existing variables are only changed with explicit approval.

## Open

- Ask Christian Wiedemann whether the skins served any other purpose, for example telling workspaces apart.
- Whether the cozy density stays (ticket 1).
- Whether the dark-mode values are final. They have been checked only on the board so far.
