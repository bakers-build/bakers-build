# bakers.build — Illustration brief: the four agent figures

Status: brief for exploration, 2026-11-03. Figma working section: "Agenten · Werkzeug-Figuren (in Arbeit 03.11.)" (621:184) on the Strategy & Branding page. Current components: `CI A / Illustration / Agent · Waage` (324:155), `· Ofen` (324:189), `· Pinsel` (324:203), `CI A / Illustration / Arbeit · Brötchen` (324:256).

## Goal

Four tool figures, one per station of the line. They are the agents: they **work**, they are not cute. They appear in the website hero, in app empty states and as 22 px icons. People are shown separately (as multiplayer cursors on the website), so the figures need no human hands or faces.

## The four figures

| Station | Tool | Character | Pose / action |
|---|---|---|---|
| Plan | Kitchen scale with a paper ticket on its plate | careful, attentive | looks at the ticket, the dial needle moves |
| Build | Oven with a terminal window `>_` (also the product mark) | diligent, calm, warm | steam rises, a prompt in the window |
| Review | Pastry brush | precise, critical eye | glazing, a small spark or shine mark |
| Ship | **Proposal: bread peel instead of the bun** | helpful, proud | slides a finished bun forward, as in shipping |

The bun is the *result*, not an agent. A peel that brings the bun out tells "Done / Ship" better. The butter bun stays the brand mark.

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
- **Brush:** "A pastry brush character leaning at an angle, glazing with a small shine mark, eyes focused and slightly critical, accent color rose (#F4AFC0) on the bristles."
- **Peel:** "A wooden bread peel character sliding a round golden bun forward, eyes proud, small sparkle marks, accent color lime green (#BFE07A) on the handle, bun in butter yellow (#F3CE3A)."

**Consistency.** From the second figure on, add: "Same style, stroke weight and proportions as the reference image."

## Acceptance checklist

- [ ] All four read as one series: same stroke, view and size.
- [ ] One rye stroke, one accent, paper fill, no gradients.
- [ ] Eyes yes, mouth and cheeks no. Reads as capable, not cute.
- [ ] Still recognizable at 22 px.
- [ ] No random detail: every element shows what the station does.
- [ ] SVG, transparent, no embedded raster.
