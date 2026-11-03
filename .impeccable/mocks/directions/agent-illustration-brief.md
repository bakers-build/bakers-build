# bakers.build — Illustration brief: the four agent figures

Status: brief for exploration, 2026-11-03. Figma working section: "Agenten · Werkzeug-Figuren (in Arbeit 03.11.)" (621:184) on the Strategy & Branding page. Current components: `CI A / Illustration / Agent · Waage` (324:155), `· Ofen` (324:189), `CI A / Illustration / Arbeit · Brötchen` (324:256), and the draft `CI A / Illustration / Agent · Lupe (Entwurf 03.11.)` (622:254), which replaces the pastry brush (`· Pinsel`, 324:203) for review.

## Goal

Four tool figures, one per station of the line. They are the agents: they **work**, they are not cute. They appear in the website hero, in app empty states and as 22 px icons. People are shown separately (as multiplayer cursors on the website), so the figures need no human hands or faces.

## The four figures

| Station | Tool | Character | Pose / action |
|---|---|---|---|
| Plan | Kitchen scale with a paper ticket on its plate | careful, attentive | looks at the ticket, the dial needle moves |
| Build | Oven with a terminal window `>_` (also the product mark) | diligent, calm, warm | steam rises, a prompt in the window |
| Review | Magnifier | precise, curious, a second look | looks closely; the eye behind the lens is magnified |
| Ship | Bun (the finished roll) | content, done | sits ready, a small sparkle |

Decided 2026-11-03: scale, oven and bun stay; the magnifier replaces the pastry brush, because glazing adds something while review checks it.

Fix in the current bun: it holds a small magnifier of its own and has a mouth ("o"). Both go: the magnifier now belongs to review, and the figures have no mouths.

## Style rules (from the CI contract, `.impeccable/surfaces/bakers-build-ci.md`)

- **Monoline:** one rye stroke `#2B2116`, the same weight everywhere (about 3 px at a 120 px figure), round caps.
- **Fill:** paper `#FFFDF8`. At most **one** flat accent per figure: butter `#F3CE3A`, lime `#BFE07A`, rose `#F4AFC0` or crust `#B8692E`.
- **Eyes:** googly eyes, two circles with pupils that show where the figure looks. **No mouth, no cheeks**, no arms or legs.
- **Action marks:** small strokes for sparks, steam or a "!", so the figure is visibly at work.
- **Flat:** no gradients, no shadows, no 3D, no texture.
- **One series:** same view (front or slight three-quarter), same proportions, same stroke weight, transparent background, square.
- **Not allowed:** monday.com-style 3D avatars, kawaii or baby-schema proportions, glossy AI look, purple glow, bakery kitsch.
- **Reference:** graza.co (tasty, human, flat food colors, illustration).
- **Legibility:** the figure must still read at 22 px.

## Tools and workflow

1. **Adobe Illustrator, "Text to Vector Graphic" (Firefly)** is the main tool, because the result is an editable vector.
   - Type **Subject**, detail low to medium.
   - **Style reference:** export the current four figures from Figma as PNG and use them as the reference, so the series stays consistent.
   - **Colors:** set the palette `#2B2116`, `#FFFDF8`, `#F3CE3A`, `#BFE07A`, `#F4AFC0`, `#B8692E`.
   - Three to four variants per figure.
   - Clean-up: set all strokes to one weight and recolor to the palette (Edit › Edit Colors › Recolor Artwork).
2. **ChatGPT (free tier)** for quick exploration. The quota is small and the output is raster; rebuild good ideas in Illustrator or vectorize them with Image Trace ("Line Art").
3. **Hand-off:** one SVG per figure. They become Figma components and replace the figures in the hero, the stations section and the empty states, with a contrast and 22 px check.

Final art may still go to an illustrator (brand foundation, section 10).

## Prompts

**Base style.** Put this in front of every figure:

> Flat monoline character illustration, single continuous dark brown outline (#2B2116), uniform medium stroke weight, rounded line caps, off-white fill (#FFFDF8), one flat accent color only, two round googly eyes with pupils, no mouth, no cheeks, no arms, no legs, small action marks (sparks, steam lines), no gradients, no shadows, no 3D, no texture, transparent background, centered, square format, calm and capable, not cute, editorial food-brand style like graza.co

**Per figure.** Append one of these:

- **Scale:** "A kitchen scale character with a paper ticket on its plate, eyes looking attentively at the ticket, needle on the dial moving, accent color butter yellow (#F3CE3A)."
- **Oven:** "A small oven character, its window shows a terminal prompt '>_', three gentle steam lines rising, eyes on the control panel, accent color crust brown (#B8692E) only on the window frame."
- **Magnifier:** "A magnifying glass character, the lens is its face, one googly eye seen through the lens looks bigger than the other, a small shine mark on the glass, curious and attentive, accent color rose (#F4AFC0) on the handle."
- **Bun:** "A round bread roll character with a scored top, sitting ready, content and calm, small sparkle marks, no mouth, accent color butter yellow (#F3CE3A) on the crust."

**Consistency.** From the second figure on, add: "Same style, stroke weight and proportions as the reference image."

## Acceptance checklist

- [ ] All four read as one series: same stroke, view and size.
- [ ] One rye stroke, one accent, paper fill, no gradients.
- [ ] Eyes yes, mouth and cheeks no. Reads as capable, not cute.
- [ ] Still recognizable at 22 px.
- [ ] No random detail: every element shows what the station does.
- [ ] SVG, transparent, no embedded raster.
