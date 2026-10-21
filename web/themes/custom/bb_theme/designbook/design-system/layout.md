# The layout layer

Every screen in the bakers.build web UI is composed on the same five pieces:

```
shell  →  canvas  →  page_header | filters | zone | inspector
```

This document is the **rule** for that layer. It says what the next author must
do, not what was decided when — the decision record is
`docs/specs/BB-378-rethink-layout-components.spec.md`. Its sibling
`action-pattern.md` rules everything that adds, edits, cancels or confirms.

## 1. The shell exists once

The shell is declared in **`designbook/design-system/design-system.scenes.yml`
and nowhere else**. A screen scene does not compose it; it inherits it:

```yaml
items:
  - scene: "design-system:shell"
    with:
      overlay: ""            # or this screen's dialog — see §7
      content:
        - component: bb_theme:canvas
          slots: …
```

The reference source is the literal `design-system` — the *location* of the
shell scenes file — never the SceneFile's `id:` (`debo-design-system`), which
does not resolve. The scene name is matched **exactly**, so it is `shell`, lower
case.

The rail, the top bar, the status bar and the command palette therefore exist in
one place. Do not add a second copy for a screen that wants a different rail
state: the inherited shell renders **one** rail state for every screen, and
buying a per-screen active trail back would mean passing the whole navigation
tree through `with:` on every scene, which is the duplication this rule removes.
In Drupal the active trail comes from the route.

## 2. The `content` slot carries exactly one layout component

That component is `canvas`, and the screen's route-bearing main content sits
inside its `main` region.

**This is a deliberate deviation from the toolchain's own rule.** The installed
`designbook` skill's `design/rules/screen-scene-constraints.md` reads the main
content as a *direct child* of the page `content` slot. Here it is one level
deeper, inside `canvas.main`. The deviation is taken for one reason: the
screen's title belongs to the screen. In the alternative — main content as the
direct child, each view mode opening with its own layout — a **list** screen
could only get its `<h1>` from a view mode, and mixing those two is what
produced the defect this layer was rebuilt to fix (a screen rendering two to
four `<h1>` elements).

Two consequences you have to carry rather than rediscover:

- - **A `full` view mode emits no layout.** No `canvas`, no region wrapper, no
  `page_header`. It emits its *content* — the zones of the body — because a view
  mode **displays** an entity while a screen **arranges** one. All three `full`
  mappings in this theme obey it, and the rule is only worth writing down if
  they agree: - `bb_ticket` emits the About / Run history / Handoffs zones;
  the ticket detail scene owns the canvas, the `page_header`, the status band in
  `canvas.header` and the meta rail in `canvas.inspector`. - `bb_team` emits
  the Members zone and the Projects relation; the team scene owns the canvas and
  the `page_header` that carries the name, the sub-line and the tab row. The
  tabs are the clearest case for the rule — *which face of the entity you are
  looking at* is a screen fact no single-record mapping can know. -
  `bb_workspace` emits **nothing**, and that is the rule biting rather than an
  omission: a workspace's `name` is the screen's heading and its
  `billing_profile` the sub-line, its timestamps and its owner are deliberately
  off screen, so after the header moves to the screen there is no body left. The
  settings scene therefore places **no** workspace node — a node that renders
  nothing reads as a screen that forgot its content. Give the entity a field
  that is neither its title nor its sub-line and the body comes back as a
  `zone`. - **The Drupal binding will have to be reconciled.** A backend that
  expects the route-bearer as a direct child of `content` meets this deviation,
  not a surprise. Whoever wires these screens owns that reconciliation; it is
  the reason this file exists rather than a comment in one scene.

## 3. Outer spacing belongs to the wrapper, inner padding to the element

A component sets **no outer margin**. The distance between two elements, and the
distance to the region edge, is set by the wrapper that places them — `canvas`
between its regions, `zone` between its cells. This is the rule that lets a
component be reused in a screen it was not built for, and it is why a `zone`
inside `canvas.main` normally carries `inset: none` when the region already sets
the distance to the screen edge.

## 4. Arrangement is configuration, not components

There is no `stack` / `inset` / `row` / `grid` component zoo. `inset`,
`direction`, `gap` and `columns` are **props on `zone`**. Two arrangements are
actually needed — a column grid and a wrapping row — and a wrapping row is what
`direction: row` is: it keeps its children's intrinsic widths, which is the only
thing a `justify_items: start` was ever used for.

`inset` and `gap` resolve to the `space-*` token scale and to nothing else. A
hard pixel value in a layout template is a bug in the layout layer, whatever it
is worth. (The leaf components still carry arbitrary values; that sweep is
explicitly out of this layer's scope, and asserted only against
`zone`/`canvas`/`page_header`/`filters`/`inspector`.)

## 5. One `<h1>` per screen

`page_header` owns it. Every further heading on the screen is a `zone` heading
and renders `<h2>`; a zone with an empty heading slot renders no heading element
at all.

So a screen places **at most one `page_header`**. A block header is not a page
header — it is a zone heading. Where a block needs a sub-line as well, it is
`zone`'s **`description` prop** — never markup in the `heading` slot. Scene YAML
sits outside the CSS build's source paths, so a utility class written there is
never compiled and the only thing that works from a scene file is an inline
`style=""`; a prop moves the styling into the template, where it is written once
and reviewable. The sub-line renders below the `<h2>` in the same treatment
`page_header` gives the screen's sub-line, and it wraps rather than truncating,
because a block sub-line is a sentence where a screen sub-line is an identity
line on one row.

On an **entity place** the `page_header` also carries the tab row, in its `tabs`
slot (§6).

## 6. The regions of `canvas` are `header`, `filters`, `main`, `inspector`

- - `header` spans the full width. It holds the `page_header`, and anything else
  that belongs above the columns for the whole screen (the ticket detail's
  status band). - `filters` is the leading aside, 236px, sticky, **absent when
  the slot is empty**. It is where a list is narrowed. The component that fills
  it is `filters`, which owns the controls and the collapse and **no layout** —
  the two-column relation is this canvas's. - `main` is `minmax(0,1fr)` and is
  not conditional: it is the region that carries the route. - `inspector` is the
  trailing 320px column of editable properties, sticky, absent when empty. It is
  named for its canonical filler, as this canvas's own `header` is for
  `page_header`.

Below `lg` the grid is a single column.

**`canvas` is not a scroll container, and neither is the shell's `content`.** An
`overflow` ancestor takes the sticky `inspector` and the sticky `filters` their
stick, and clips every absolutely positioned picker panel — a `meta_row`'s
inline edit, a facet control — at the region's edge instead of letting it open
over it. Do not add one.

There is no breadcrumb region: the IA decided none.

## 7. The two injection points

The inherited shell exposes exactly two, and a screen fills both:

| Placeholder | Slot | What a screen puts there |
|---|---|---|
| `$content` | `content` | exactly one `canvas` |
| `$overlay` | `overlay`, beside the command palette | its create or confirm surface, or `""` |

`$overlay` exists because `action-pattern.md` puts every create and confirm
surface in the shell's `overlay` slot over the screen it was opened from, and an
inherited shell cannot know which screen opens one. A screen that opens none
fills it with the empty string — which renders nothing, and is the same "absence
is the point" the add action follows. Leaving it unfilled renders the marker as
literal text.

Rendered as its own story the shell scene substitutes neither, so both markers
show as text there. That is the injection point made visible, not a fault.

## 8. Naming

Layout and chrome components use `snake_case`; data and display components use
`kebab-case`. The line falls exactly on *arranges* versus *displays*, so the
spelling of a node in a scene already says which kind it is.

## 9. `section` is legacy

`components/section/` still exists, for the retired dashboard's two
`display_builder` page-layout copies and the two Playwright step files that bind
them through it. **No file under `designbook/` may reference it** — a scene, a
mapping and a story all use `zone`. `section` dies with the wiring/retirement
ticket.

## 10. Data and display

**A listing is a View.** It is addressed `entity: "view.<id>"`, resolved by one
view mapping, and it emits one container node. Not repeated single-entity nodes,
and never `records:` — the demo shorthand that repeats one entity across sample
indices. This is the toolchain's own rule, in the installed skill's
`design/rules/screen-scene-constraints.md`, and it is the one rule of that file
this theme had never used: which is why the theme grew eight components whose
only job was to be one item of something — five table rows and three list
entries. A row component is what a missing View looks like from the inside.

**A container owns what is inside it**, and there are three:

```
table:  columns[] + rows[]   { url?, accent?, cells{ <column key>: Cell } }
list:              items[]   { url?, accent?, cells{ <key>: Cell } }
form:   lead? + lines[] + pills[] + actions[]
```

No row, column, entry or field component exists. `columns` and `rows` are
**props, not slots**: a slot is how the previous architecture injected an
already-rendered row, and keeping one would keep the escape hatch that let a
whole table be hand-assembled in the middle of a screen. A cell whose key is not
in `columns`, and a column with no cell in a row, are errors — keying them
against each other in one place is the entire point. `table` and `list` are two
components and not one because **the sortable header cell is what makes a table
a table**, and a list has no header to sort; below the header they are
identical, which is why `list` adds only `layout: lines|cards` for the two
densities the tree actually has.

**A cell is plain data with a `kind`** — `text` | `mono` | `link` | `badge` |
`person` | `picker` | `masked` | `action` — rendered by one shared Twig macro
that both read-only containers import. So exactly one place in the theme knows
what a badge cell or a person cell looks like, and a badge in a table cell and a
badge in a list item are the same code path, not two that agree. What makes a
prop legal where a slot used to sit is the constraint the layer already carries:
**props carry scalar data only and never rendered content**, and a cell is data,
not content. A value shape the kinds cannot express is the signal to add **one
more kind, deliberately** — never to reintroduce a slot. A slot here buys back
the freedom this section exists to remove.

**`action` is that rule already applied once, and it is the one kind that is not
a value.** The seven before it render something a record holds; a listing whose
items can be acted on had nowhere to put the control, and the shape that asked
for it was a membership's remove button, whose accessible name is a whole
sentence — which a `text` cell would have printed as prose on every item. It is
item-scoped, so any listing may carry a row action, and its fields are
`button`'s own so the cell invents no vocabulary: `label`, `icon`, `icon_only`,
`variant`. There is no separate accessible-name field, because `button` moves
`label` into `aria-label` when the control is icon-only and a second name field
is a second copy of one name that can disagree with the first.

**A `picker` cell carries what the picker needs** — `clearable`, `clear_label`,
`creatable`, `create_label` and `icon` alongside the value and the options — or
the rail loses the ability to unset a field, because the clear row of the option
list is the only unset affordance this design has. Each field is passed to
whichever component declares it: the clear and create rows belong to
`option_list`, which owns them because they are rows of the listbox, and the
icon belongs to `option_picker`, which owns the trigger.

**`form`'s props encode `action-pattern.md`'s widget grammar** rather than
describing it. `lead` is singular because the grammar allows at most one
property per surface to leave the row and be emphasised — "a surface where
everything is emphasised emphasises nothing" — so the cardinality is carried by
the type and a caller cannot violate it. `lines` is the two borderless text
lines, `pills` is the ONE wrapping row of properties, `actions` is the footer. A
flat `fields[]` array would have permitted precisely what the grammar forbids:
three text lines, two prominent properties, a form of labelled rows. For the
same reason a pill's `value_label` is optional rather than a required empty
string — the grammar says a pill shows the field name when unset and never a
bare dash.

**A rich body is `rich-text`**, and nothing else in the theme carries a prose
treatment, so a comment body and a ticket description — the same format,
from the same field type — render alike. `bb_rich` is GitHub-flavoured
Markdown that **strips raw HTML**, so a body authored as HTML renders empty and
must be written as Markdown. Pipe tables **do** arrive as real `<table>`
markup, and `rich-text` styles them: a body containing a table is never
line-clamped and scrolls horizontally inside its own focusable region instead
of widening the page.

**`form_input` and `form_label` are the written exception** to *no
single-caller components*. Each has effectively one caller and each stays,
because the caller is not a component: it is **Drupal's own form renderer**,
through `templates/input.html.twig` and `templates/form-element-label.html.twig`.
Folding a component into that caller would move theme markup out of the
component layer and into a template override, where no story reaches it. Both
therefore keep `disableBasicStory: true` and no `designbook/` scene addresses
them — they are the backend half of the surface `form` owns, and the reason is
written here because without it the rule reads them as two components to delete.

## 11. Groups

`group:` in a `component.yml` is **the** classification. It is SDC's own field,
every component already declares it, and Storybook builds its sidebar from it.
Seven values are in use, and §8's naming convention is **derived** from them, so
there is no second list to drift:

- **arranges → `snake_case`** — `Layout`, `Shell`, `Navigation`, `Action`,
  `Form`
- **displays → `kebab-case`** — `Data Display`, `Media`

A single-word name carries no separator and satisfies either. A component in the
wrong group is a **classification bug**, and it is fixed in its `component.yml`
— **never** by renaming the directory to match a group the component does not
belong in. It is also why no list of component names appears in this file: the
classification is a field, any copy of it here is a second copy that drifts, and
what reads the field is the gate.

`Action` and `Form` are two groups and not one on purpose. `Action` is the group
that pairs with `action-pattern.md` — everything that adds, edits, cancels or
confirms — and its members are used far outside any such surface:
`option_picker` 24 times, in the ticket-list filters, the ticket-detail meta
rail and five project-detail scenes. A filter picker in a group called `Form`
would be a lie about where it is used. `Form` holds the add/edit surface itself
and the two components Drupal's form templates render through.

`collapsible` is in `Layout` and belongs there: it arranges a region that opens
and closes, and `filters` composes it for exactly that.
