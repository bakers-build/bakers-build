---
version: 1
slug: "bakers-build-ci"
primary_target: "bakers-build-ci"
related_targets: []
---

# bakers.build · visual identity (CI), marketing landing, bakers ui, web app

## Scope and mode
- New visual world for the rebrand to bakers.build: logo, color, type, illustration, components.
- Surfaces:
  - website/landing (**Persuade**);
  - web app and `bakers ui` terminal (**Operate**);
  - docs (**Read**).
- Approved composition: `.impeccable/mocks/directions/a-kombi.html` (approved by the user 2026-10-22). Supporting files: `logo-avatare.html`, `brand.js`, `bakers-line.js`.
- Revision in review: `.impeccable/mocks/directions/teig-terminal-v2.html` (2026-10-23), portraits in `directions/portraits/` with `CREDITS.md`. Figma: page "Branding" (166:13621), sections "Moodboard · bakers.build (23.10.)" (373:826) and "CI A v2 · Teig & Terminal (Entwurf 23.10.)" (373:827), captured from the HTML.
- Web app appearance (approved 2026-11-02): `docs/decisions/app-appearance.md`. Light and dark only, no skins; token values, the butter rule and WCAG results are there. Figma: page "Vorschläge & Konzepte" (67:45), section 550:8845, collection "BB · Vorschlag CI".
- Prisma (round 4) was dropped by the user after the Figma board; this contract replaces it.

## Audience, job, action
- First the agency lead (P1, not a developer), credible to developers (P2); personas in `PRODUCT.md` and `docs/decisions/brand-foundation.md` (approved 2026-10-23).
- Job: see that agents do the work on their own machines while a person takes part at every station and has the last word.
- Actions: primary "Start a free trial" (a request; we set up the workspace); secondary self-host for free / start with your own agent (`npm i -g @bakers-build/bakers`); quiet "Book a demo". Open source (MIT) is the offer itself.
- Moodboard: `.impeccable/mocks/moodboard/index.html` (2026-10-23).

## Direction contract
THESIS: An honest tool with a terminal core, packaged like good food. Tools are the agents, baked goods are the work. Refuses the dark cosmic AI hero, purple glow and glossy 3D agent avatars (monday-style).
OWN-WORLD:
- Color (roles decided 2026-10-23): flour ground #F5EBDA; paper #FFFDF8 for cards and figure fill; rye ink #2B2116 instead of black; rye-2 #5A4A38 secondary text; muted #6E5D49 (replaces #7D6C58, which fails AA on flour). Food colors as flat fields at page scale, one per section, never gradients: butter #F3CE3A = waits for you and the primary action; lime #BFE07A = running and good (passed, done, open source band); rose #F4AFC0 = review and sent back; crust #B8692E = graphics only (counter, logo accent), never text. In the web app (2026-11-02): surfaces are flour-tinted (app #F7F2E8, cards #FFFDF8), not flour itself; in light mode butter is only the "waits for you" fill with rye text, never a dot or line, and primary/selection is rye; in dark mode butter is also primary. Values in `docs/decisions/app-appearance.md`.
- Type (decided 2026-10-23): Bricolage Grotesque display (bold, high optical size, tight tracking), replacing Instrument Serif; the wordmark is reset in it. Spline Sans text. Spline Sans Mono only for commands, states, IDs and numbers.
- Illustration: monoline Graza style (one rye line, white fill, googly eyes of equal size that never overlap, action marks such as sparks, steam and "!"), a small, subtle smile and no cheeks on the tools (decided 2026-11-03). Tools work, they are not cute; hero plus at most two more places on the website, empty states and 22 px icons in the app.
- People at every station (decided 2026-10-23, concept B): real people in an avatar circle (butter ring, rye hairline) under each tool, with role and action ("your client · approves the plan"). In the app it is the actual user's avatar. On the website the portraits come from Unsplash or are AI-generated (owner decision 2026-10-23). They illustrate roles only: no names, no quotes, no company logos, never presented as customers or testimonials.
- Components: pill buttons; hairline dashed dividers; terminal in rye brown.
STORY: The visitor sees the line: at every station a tool does the work and a real person confirms, approves or authorizes the merge. They believe nothing happens without a person, see that they can adapt the line (recipe = `WORKFLOW.md`), and start a free trial or self-host for free.
FIRST VIEWPORT:
- Wordmark with the looking-bun mark top left; mono nav; "Start a free trial" top right.
- Display headline "You're the baker. Agents run the line." (Bricolage Grotesque) on the left, with the "prep is done" subline; "Your recipes. Your line." as supporting line.
- On the right, the counter with scale, dough scraper, oven, brush and a finished roll, each with its tag and a real person's avatar circle with role underneath.
- Below, a full-width butter band for the trial request with the self-host command beside it; then a ticker with three proof points (the hosted case is explained where hosting is mentioned).
FORM: Direction A "Teig & Terminal", combined variant, chosen from user-supplied references (typesafe.ai, graza.co, raus.life, monday.com) after the seeded rounds failed; seed:676d48ebe217d4cd is superseded and no seed applies to this direction. Logo system: bun = brand mark (web, docs, social, empty states); oven with terminal window = product mark (app icon, favicon, bakers ui, CLI). Signature: the counter line-up in the hero; in the app, agents as 22 px tool icons, and what waits for you is butter-filled.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Portrait set for the website avatars: pick Unsplash portraits (licence noted per file) or generate them; one consistent crop, light and warm.
- Copy for the three beats, "Your recipe" and "Free, self-hosted or hosted" (copy step).
- Dark mode for `bakers ui`; mobile layout of the landing. (Web app dark mode is decided in `docs/decisions/app-appearance.md`; its values are checked on the board only.)
- Production illustration: the hand-drawn SVGs are placeholders; a final redraw may need an illustrator.
