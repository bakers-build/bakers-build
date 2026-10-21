# Linear style

## Character

A Linear-inspired visual language for dense working interfaces: restrained
colour, strong type hierarchy and fine dividing lines make information easy to
scan. Near-white surfaces and dark neutral text establish a quiet foundation.
Accent colour identifies action and selection; status colours carry specific
meaning. Weight and contrast distinguish importance without turning every
element into a headline. High density is the intended character; its spatial
expression belongs to the separate layout axis.

## Authority and scope

This file is a design tool and prose description, not a second generator. If
this document and the Designbook token model, design-tokens.yml, disagree, the
model wins. The values below describe the intended style, including ramps and
typography that may not yet be represented in the model; they do not override
current tokens.

Only colour, type, elevation and line weight belong here. Spacing, heights and
layout geometry belong to the separate layout axis and are outside this
document.

## Colour palette and ramp logic

Each family has ten stops: 50, 100, 200, 300, 400, 500, 600, 700, 800 and 900.
The ramps move from pale tints to dark ink with progressively lower lightness.
They are perceptually tuned rather than equal numerical increments: the pale
end stays quiet, the middle carries identity, and the dark end supports
legible text. All values below are opaque sRGB colours in hexadecimal
notation.

| Stop | Neutral | Violet | Red | Amber | Teal | Indigo |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | #FAFAF7 | #F3F3FF | #FFF3F1 | #FFFBEB | #F0FAF8 | #F3F5FF |
| 100 | #F1F0EA | #E8E8FF | #FFE2DD | #FFF2C2 | #D9F2EE | #E6EBFF |
| 200 | #E9E7E0 | #D3D4FF | #FFC5BB | #FFE58A | #B5E4DD | #CDD7FE |
| 300 | #D6D3CA | #B2B5FA | #FF9D8D | #FFD451 | #81CFC5 | #A8B9FC |
| 400 | #A5A6A3 | #858AF2 | #FF7463 | #FFC024 | #4BB9AE | #8197F8 |
| 500 | #707888 | #6268EB | #FF4E42 | #E3A008 | #329D93 | #6078E5 |
| 600 | #5B6169 | #494FE5 | #D73D30 | #B77C00 | #278178 | #4A60C8 |
| 700 | #444A52 | #3D42BE | #A5301F | #7A5600 | #1F6B63 | #3B4BA8 |
| 800 | #2C3137 | #323795 | #7F291D | #604500 | #1B514C | #303E82 |
| 900 | #14171A | #292D70 | #602219 | #493600 | #173D39 | #27325F |

Neutral carries surfaces, dividers and text. White (#FFFFFF) is the base
surface; neutral 50 and 100 provide subtle tonal distinction. Neutral 200 and
300 give fine lines definition. Neutral 600 supports secondary text and
neutral 900 anchors primary text and titles.

Violet is a concentrated blue-violet, centred on #494FE5 at 600. Reserve it for
primary actions, links, selection and focus — it names the family, not the role
it plays; the role is `semantic.color.primary`/`link`/`focus-ring`. Indigo is a
quieter, more muted blue family for categorical or status meaning, distinct from
the violet used for action. Red communicates
errors or urgency, amber attention, and teal positive or active states. Keep
colour use selective so that status remains recognisable in a largely neutral
interface.

Across the chromatic families, 50–100 supply quiet tinted surfaces, 200–300
supply subtle coloured boundaries, 400–600 supply identifying marks or strong
fills, and 700–900 supply dark coloured text. These are role directions, not
automatic foreground/background pairings. Pale tints and bright status colours
are not body text colours; select readable pairs for the actual surface and
retain a textual or symbolic cue alongside status colour.

## Type scale

Use the platform system sans-serif for interface text, with Segoe UI, Roboto,
Helvetica Neue and Arial as familiar fallbacks. Use a system monospace face
for identifiers and technical values, with SF Mono, JetBrains Mono, Menlo and
Consolas as fallbacks. This keeps the voice practical and readable.

Sizes are in pixels; line-height values are unitless multipliers. Regular means
400, medium 500, semibold 600 and bold 700.

| Role | Size | Weight | Line height | Rationale |
| --- | --- | --- | --- | --- |
| Display | 24 | Bold | 1.2 | Establishes the main title clearly while remaining proportionate to a dense working interface. |
| Heading | 16 | Semibold | 1.3 | Separates major content groups with a visible step above body text and a controlled voice. |
| Body | 13 | Regular | 1.5 | Supports sustained reading and frequent scanning; the generous line height preserves clarity at a compact size. |
| Caption | 12 | Regular | 1.45 | Keeps metadata and supporting explanations readable while making their secondary role apparent. |
| Eyebrow | 11 | Semibold | 1.2 | Gives short category labels enough emphasis to orient the reader without competing with headings. |
| Mono | 12 | Medium | 1.45 | Makes identifiers and technical values easy to distinguish, with sufficient weight for small monospace glyphs. |

Hierarchy comes from these deliberate size and weight changes, reinforced by
neutral contrast. Avoid using faint text as the only way to distinguish a role.

## Elevation

Use three restrained shadow steps. Each uses neutral 900 (#14171A), with no
spread or directional offset; blur and opacity alone express increasing
elevation. These shadow characteristics belong to the style axis.

| Step | Shadow opacity | Shadow blur | Purpose |
| --- | --- | --- | --- |
| 1 — Subtle | 6% | 4 px | A slight lift for a surface that needs separation beyond its fine border. |
| 2 — Floating | 10% | 12 px | Makes transient menus and popovers distinct from the content beneath them. |
| 3 — Foreground | 14% | 24 px | Gives dialogs and other foreground surfaces a clear, calm sense of depth. |

Ordinary content remains flat, without a shadow. Elevation communicates layering
and attention; it is not a decoration applied to every surface.

## Lines and borders

Use a 1 px line for ordinary dividers and surface borders. Neutral 200
provides quiet separation; neutral 300 gives a boundary greater definition.
Keep line colour consistent within the same role so that the interface reads
as one system.

Use a 2 px accent line for focus or an explicit selected-state indicator when
stronger emphasis is needed. This is a deliberate emphasis treatment, not the
standard divider weight. Status-coloured boundaries draw from their own family
and remain secondary to readable text.

## What this style does not do

- It does not prescribe spacing, padding, margins, heights, widths,
  radii, grids, alignment or responsive layout geometry; those belong
  to the layout axis.
- It does not use decorative gradients, glass effects, textures, neon glow or
  large saturated backgrounds as its visual identity.
- It does not use oversized marketing typography, ornamental typefaces or extra
  type steps to create hierarchy.
- It does not frame every content group with a heavy border or a strong shadow.
- It does not communicate status through colour alone.
- It does not define motion, interaction behaviour, component implementation or
  an alternate dark palette.
- It does not generate tokens or supersede the Designbook token model.
