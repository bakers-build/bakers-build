# The action pattern

Every surface in bakers.build that adds, edits, cancels or transitions a ticket
follows the one pattern described here, without variation. This document
sits at the design-system level rather than in a section because the
pattern crosses every section: the tickets screens, the board and the
organisation settings all obey it.

Its sibling is [`layout.md`](layout.md), the rule for the layer these
surfaces are composed on — the inherited shell, the single `canvas`, one
`<h1>` per screen, spacing as configuration on the token scale. Read it
before placing a control anywhere: which region an action lives in, and
which of the shell's two injection points a dialog goes into, are decided
there.

**They do not all obey it through a dialog**, and this paragraph used to
say they did. The organisation screens (BB-338) edit everything
reversible INLINE — a role, a team's projects — under *Inline edit* below,
because the fields are reversible and the rule for a reversible field is
the same wherever it lives. What they ADD **from a screen they would have to
leave**, they add through the dialog like everything else: their one such
surface, `project-create`, is a centered `dialog` in the shell's `overlay`
slot over the projects screen. What they add to the list *in front of them* is
a control of that list's own face — a form the operator submits, not a hull —
and *Create and edit surfaces* below draws that line.

So this document records **no special case at all**. It briefly recorded
one — `project-create` as a full-page route — and the human reversed that
at BB-338's coding gate, on the rule's own reason: a route was rejected
because it loses the LIST CONTEXT, and a project create surface has a list
to lose. A design system whose one pattern carries a footnote invites the
next surface to claim one, so the footnote is deleted rather than kept as
history.

## The rule

> **An action is confirmed exactly when it ends or discards the ticket.**
> Everything else is single-step; where a single-step action has a
> server-side side effect, the side effect is **named** instead of confirmed.

Both halves matter. The first half keeps confirmations rare enough that
they still mean something: a dialog asking "are you sure?" in front of a
reversible change trains the operator to dismiss dialogs unread. The
second half is what the first half would otherwise leave dangerous. A
single-step action can still start work on a server, and the operator has
to be able to see that before they act. Naming the effect at the control
is how a single-step action stays honest.

| Action | Confirmed | Why |
|---|---|---|
| Create, conductor cleared | no | reversible |
| Create, conductor set | no, named | chosen at the field |
| Inline edit (assignee, priority, type, recipe, labels) | no | reversible |
| Inline edit, conductor set | no, named | chosen at the field |
| Transition `plan` to `working` | yes | dispatches an agent run |
| Transition to `done` | yes | terminal, no rollback |
| Cancel ticket | yes | discards the ticket |

Three rows need their nuance spelled out. The transition row covers every
sibling transition, not only `plan` to `working`, because each of them
dispatches an agent run server-side; the confirmation names that run. The
`done` row confirms because `done` is terminal and there is no rollback,
so the confirmation names the terminality rather than the run. The two
**conductor** rows are not confirmed because the choice was already made
explicitly, at the field — and they are the reason the second half of the
rule exists at all. Setting a conductor has the same server-side effect
wherever it is set: the ticket is claimed at the next poll and an agent
run starts. So the create dialog names it beneath the pill row, and an
**inline** conductor pick on a detail screen names it at the field too.
Every other inline field is reversible and names nothing.

A confirmation names the concrete effect and never asks "are you sure?".
"Move BB-332 to `working`? This dispatches an agent run on
`cw-framework`." tells the operator what will happen. "Are you sure?"
tells them only that something will.

## The confirmation is not a component

A confirmation is the **`dialog` component with prose in its `body` slot
and two actions**, not a second component. There is deliberately no
`confirm_dialog`: a confirmation differs from a create dialog in its
content, not in its structure, and a separate component would drift from
the hull it was copied from.

## Create and edit surfaces

A create or edit surface is a centered `dialog` in the shell's `overlay`
slot, not an off-canvas tray and not a standalone route. The tray was
rejected because its unlayered core reset beats Tailwind's `@layer`, so
bakers.build components rendered inside it lose their styling. A route was
rejected because it loses the list context and cannot serve the edit and
cancel cases, which must overlay a detail screen.

**What counts as a create or edit SURFACE**, stated because leaving it
implicit is how the rule came to be read as covering things it was never
argued for. A create or edit surface brings an entity into being, or edits
one, **from a screen it would have to leave** — it has a list context to
lose, which is the rule's own first reason. `project-create` is one: it
adds to the projects list and the list is what tells the operator the
addition worked.

An **assignment inside a face** is not one. Adding a member to a group is a
control *of* the Members face: it acts on the very list it sits above, and a
successful submit re-renders that face and nothing else, so there is no
context to lose and a dialog would take the roster away in order to add to
it. The pattern that applies to it is the one below — a form the operator
submits, with one primary action — and not the hull. This is a narrowing of
the rule's reach, not an exception to it: the two conditions that make the
dialog right are simply absent, and a rule does not extend to a case
neither of its arguments touches.

**The workspace invitation is the one exception, and it is an operator
ruling, not a reading of the rule.** Inviting takes several addresses, a
workspace role and a team, which is a surface of its own rather than one
control above the roster; the operator chose one focused dialog for it. It
opens from the Members zone's primary **Invite members** action and closes
back onto the face it came from, so the roster is covered only while the
dialog is open. Adding an existing workspace member to a team stays the
inline control above.

The distinction is drawn on the CONTEXT and not on the entity, so it cannot
be claimed by whatever wants to avoid a dialog. A surface that adds from a
place the operator must leave is a dialog, whatever it adds; a control that
acts on the list in front of it is part of that list's face, whatever it
writes.

**The rule holds without exception**, organisation surfaces included. The
one surface that ever claimed to be outside it, `project-create`, is a
`dialog` in the `overlay` slot over the projects screen (BB-338): a
project create surface has a list to lose, which is the first half of the
rule's own reason, so the rule reaches it. The second half — that a route
cannot serve the edit and cancel cases — is simply not needed to decide
this one, and a rule does not stop applying because only one of its two
arguments bites.

The rule's reach is therefore the whole tree, and there is no per-section
carve-out to look up before designing a create surface.

**Nothing here weakens *Inline edit*.** A reversible organisation field —
a membership role, a project's teams, a term's weight — is picked in place
under that section's existing rule, and none of them has a side effect to
name.

## The widget grammar of an add or edit surface

The dialog is **not a form of labelled rows**. It follows the widget
grammar of Linear, which BB-327 chose as this UI's reference, and the
grammar is a rule rather than a style — every add, edit and organisation
surface uses it without variation.

1. **There are no visible labels.** The two text lines carry their
   identity in their placeholder; every property carries its identity in
   the pill itself.
2. **Two borderless text lines** open the surface: a large title line and
   a smaller description line beneath it. No box, no border, no label
   column. They are the `form` component's `lines`, which exist precisely
   because `form_input` cannot be un-bordered from outside.
3. **Every property is a pill** in ONE wrapping row beneath the text —
   the `form` component's `pills`, each composing `option_picker` in its
   `field` variant. A pill is a small rounded outline chip of icon plus
   text, about 28px high, which opens a popover.
3a. **A property that is not a peer of the others leaves the row.** Where a
   property constrains the rest, or cannot be changed cheaply afterwards,
   it gets **its own row above the text lines**, separated from the body,
   and is rendered heavier (`prominent`). On the create dialog that
   property is **workflow**: it decides the ticket's whole state flow, so
   choosing `bb_work` rather than `bb_deployment` decides which states the
   ticket will pass through (the kind of work — feature, bug, chore, epic —
   is the separate `ticket_type` property, a pill like the others), and
   reversing it later is not a cheap edit.
   Making it merely the first pill was tried and was not enough — first in
   a row still reads as "the first of these", and it is not one of these.
   At most one property per surface earns this; a surface where everything
   is emphasised emphasises nothing.

   **Not in the head breadcrumb.** `bakers.build › Feature › New ticket` was
   considered and rejected: the head already carries the context picker,
   and **two pickers in one breadcrumb** read as a single compound control
   rather than as two independent choices. The head answers *where this
   acts*; the workflow row answers *what kind of thing this is*.
4. **A pill shows the field name when unset and the value when set.**
   "Conductor" becomes "cw-framework"; "Labels" becomes the labels. This
   is what lets the labels disappear without the surface becoming
   unreadable, and it is why an empty pill must never render a bare dash.
5. **The popover is a searchable list** with a checkmark on the current
   value, and the clear option as a **normal first row** — "No
   conductor", "No parent" — never a button above the list and never a
   native `<option>`. Group headers are permitted inside the list where a
   field has natural groups; the grammar agrees where they go and nothing
   fakes them until a field needs them.

   **Search: one half is real, one half is a boundary.** Typing in the
   search box **filters the rows that are rendered** — the handler
   narrows them on input and hides non-matching rows with the `hidden`
   attribute, so a hidden row is hidden from assistive technology too and
   the no-JavaScript rendering is still the full list. What is still a
   boundary is **where the candidates come from**: nothing fetches, so a
   picker can only ever filter the rows its caller rendered. The parent
   field needs a server query over every ticket in the project to be
   genuinely useful, and that query belongs to the ticket that gives it
   real candidates. Saying which half exists is the point — an input that
   filters a list of two hardcoded rows must not be mistaken for a
   working ticket search.

   One placement caveat that belongs with the panel and not with the
   search: the dialog scrolls (`overflow-y-auto`), and an absolutely
   positioned panel cannot escape a scrolling ancestor, so a panel opened
   low in a tall dialog is clipped at the dialog's edge. Correct placement
   needs the top layer or the Popover API, which is runtime work and sits
   on the same side of the boundary as modality and focus trapping.

   Note for whoever reviews this in Storybook: Storybook does not call
   `Drupal.attachBehaviors`, so no behaviour of this theme runs there —
   the pills do not open and the box does not filter until a real Drupal
   page attaches them. Every rule above is a property of the markup for
   exactly that reason.
6. **Rarely used properties collapse behind an overflow control.** The
   threshold is that beyond roughly six pills the low-frequency ones move
   behind a `…` in the same row, so the row never wraps into a block.
   Below the threshold there is **no** overflow control at all: the create
   dialog carries four pills and ships none, because a `…` that opens
   nothing is a worse lie than an absent affordance.
7. **One primary submit.** The secondary action is `Cancel`, or a
   "create another" toggle — never a second submit.
8. **Context is a breadcrumb CONTROL, not a field.** The project appears
   in the dialog head, before the title, as a picker with the same pill
   grammar — pre-filled from wherever the operator came from and
   changeable there. It is not a body field, which is what keeps the pill
   row from growing; and it is not static text either, which is what the
   next section is about.
9. **A property that another property decides is not a field.** The
   create dialog carries **no assignee control**, because an assignee
   **follows from the conductor** — so asking for it separately would be
   a redundant decision taken at the moment the operator knows least.
   The accepted consequence is stated rather than hidden — an assignee is only
   ever as good as the conductor-to-person mapping behind it, and where
   that mapping is wrong the fix belongs at the mapping, not at a second
   control on this dialog. A detail screen may still override an assignee
   inline: the derivation decides what a ticket *starts* with, not what it
   is stuck with.

### Who owns the add action

**The add affordance is owned by the screen that can receive it**, never by
the shell. The chrome carries no entity-add action at all.

This is the same objection as the icon-only change, one level up. A global
"Add \<entity\>" button in the top bar is Drupal's route-derived add logic
wearing chrome: the shell cannot know whether the screen under it accepts
an addition, so it either shows an action that sometimes lies or hides one
that sometimes puzzles. The screen knows. So the screen renders it, in its
own `page_header`, right-aligned.

On a screen that cannot add, the affordance is **absent, not disabled** and
not hidden. A hidden control is still a promise the screen cannot keep, and
a disabled one invites the operator to hunt for the condition that would
enable it; where the answer is "not here", nothing is the honest rendering.

Two states are easy to confuse and behave differently:

- **absent** — this screen **cannot add at all**. There is nothing to
  resolve; the operator would have to go to a screen that can.
- **present, with unresolved context** — this screen can add, and a
  required value is missing. The operator supplies it **in the dialog**,
  at the context control. See the next section.

Both sides of that conditional are shown as scenes, deliberately: a rule
demonstrated only where it is true is not demonstrated.

**Amendment (BB-341) — a navigation row that *is* the list it adds to owns
its add action.** The rule above is aimed at chrome that speaks for a screen
it cannot see. A navigation row that renders a list is not that. The sidebar's
`Teams` row **is** the list of teams: its `[+]` adds to the rows directly
beneath it, its target is on screen, and it never speaks for the screen under
it, so it can neither lie nor puzzle. The affordance therefore sits, as
always, on the surface that receives the addition — the same rule applied one
surface further in, not an exception to it. Being the pattern's own control
rather than a bespoke one, the `[+]` is `button` in its `ghost` + `icon_only`
variant with the `plus` icon.

The boundary the rule was written against is unchanged and still binds:
**no global "Add \<entity\>" control in the top bar, and no add action on a
navigation row that merely links to a screen.** A navigation row earns an add
action only when the row itself renders the list that receives it. A row that
is a link to somewhere else is chrome, and the chrome still carries no
entity-add action at all.

### Where context comes from, now that the route no longer decides

Drupal derives "what can be added here" from the route, and the first
version of this pattern inherited that: with no project in scope the
create dialog **refused**. The reference contradicts it. Linear's own
create dialog carries a `Set team` button *and* a `Change project`
combobox, both pre-filled from where you came from and both changeable on
the spot. It does not refuse; it asks.

So context is **resolved, not routed**, in this order:

1. **the action carries it** — the `+` on a board column carries that
   column's state, the `+` on a ticket row carries that ticket as parent,
   a "New ticket in \<project\>" entry carries the project;
2. **the current view supplies it** — the project or board in scope;
3. **the session supplies it.** This is not speculative: bakers.build's TUI
   already works this way. It resolves the new-ticket form's default
   project and its preselected conductor from the `bb_conductor` record
   whose `workspace_root` equals the `.bakers` directory `bakers ui` was
   started in. A context object, not routing;
4. **nothing resolves** → the dialog opens with the context control
   **empty and asking**, and the submit is disabled.

That last state must not be confused with the refusal it replaced, and
the difference is what the operator can do about it:

A submit disabled **because a required value is missing** is a state the
operator can resolve **inside the dialog** — they pick the project in the
head and the submit comes alive. A submit disabled because the action does
not apply here is one they can only resolve by **navigating away**. This
pattern produces the first and names the missing value; the second is what
route-derived add logic produced, and it is gone.

### Creating the thing you are looking for

A picker may offer to **create** the value being searched for, so a
missing label or a missing team does not send the operator out of the
dialog to make one. The create row is the **last** row of the panel — the
mirror image of the clear row, which is first: clearing picks a value,
creating performs an action. For that reason it is a button in a
presentational row rather than a `role="option"`; announcing an action as
a selectable value would misdescribe it.

Its label follows the query: `Create "frontend-build"` while something is
typed, and a plain `+ New label` when the box is empty.

**One half is real.** The affordance is rendered, positioned and
reachable, and it **creates nothing yet** — no surface in this pattern
posts. Wiring the write belongs to the ticket that gives these pickers an
endpoint. The demonstrated case is **labels** (a bakers.build label is a
`bb_term`, so creating one in place is a real workflow); the motivating
case is **teams**, from the BB-315 tenancy model, where the thing you
need rarely exists yet.

### What dropping the labels costs, and how it is paid

A visible `<label>` is an accessible name. Removing it makes the
**accessible name load-bearing**, so it is not optional decoration here:

- Every pill carries `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded`, an `aria-controls` naming its panel, and an
  `aria-label` in the state-carrying form "Change conductor. Currently no
  conductor is set."
- Every text line carries an `aria-label` too. A placeholder is a weak
  accessible name: it is not announced by every screen reader, and it
  disappears as soon as the operator types.

The rest of the debt is named rather than hidden. A `role="combobox"`
promises focus management, `aria-activedescendant` and Escape; only
Escape exists today. The remainder belongs to the ticket that makes these
dialogs interactive, and until then the pill is a keyboard-reachable
button that announces itself correctly — not a fully implemented
combobox.

Single-choice fields have **no SDC of their own** in this grammar. The pill
is the dialog's widget, and a real Drupal form renders `#type => select`
through Drupal's own element template — which is why BB-378 (D17) could
delete `select_field` as unreferenced.

The dialog carries **exactly one submit action plus cancel**. The TUI
additionally offers "Create with agent", which writes a temporary JSON
spec and launches a local process on the operator's machine. A browser
has no local process, so that row has no web equivalent and does not
exist here.

The web's agent affordance is the **conductor field** instead: set means
the ticket is claimed at the next poll and an agent run starts, cleared
means it waits for a human. The side effect therefore moves from a button
to a field, and is named there, per the second half of the rule.

There is **no project field in the body**. The project is context — and
since D15 a *control*, not static text: it sits in the dialog head as the
picker of rule 8, pre-filled from wherever the operator came from and
changeable there. Where nothing resolves it, the dialog does **not**
refuse. It opens with that control empty and asking, names the missing
value in its `message` slot, and leaves the submit disabled until the
operator supplies the value in the head.

The refusal that used to stand here is recorded in the spec as D3 and is
**superseded by D15**. The two states are not interchangeable, and the
section *Where context comes from* above is the one that binds: a submit
disabled because a required value is missing can be resolved inside the
dialog; a submit disabled because the action does not apply here can only
be resolved by navigating away, and this pattern no longer produces the
second.

## Three levels of error, and a rejected write costs nothing

1. A **form-level refusal** (a server 422, a missing project, an empty
   title) renders as a `message` with `status: error` in the dialog's
   `message` slot, above the body. Any field change retires it, so a
   refusal never describes a form that no longer exists.
2. A **field-level error** uses the `errors` slot that `form_element`
   already provides.
3. **Every typed value survives a refusal**, and the dialog closes only
   on success. A rejected write must never cost the operator their
   typing.

## Inline edit

On a detail screen the reversible meta fields (assignee, priority, labels,
conductor) are edited in place with an `option_picker` in its `inline` variant —
the pill grammar one size smaller: the same component, the same self-naming
`aria-label`, the same popover with the clear row first, only without the pill's
chip chrome, because on a detail screen the value is already the thing on the
page. A pick changes nothing until **Save**, the same explicit commit a Settings
form uses: the primary button at the right of the separated action row below the
properties. A completed save shows Drupal's ordinary status message
(`bakers.build ticket <label> saved.`) as the bottom-right toast every status
message uses, and leaves the operator on the screen; a rejected save keeps the
attempted values and names the error, which is the dialog's rule one level
smaller.

A single organisation control inside a list row — a membership role, a
team assignment, a term's weight — still writes on pick. It is one field
with one control and no neighbouring properties to commit together, so it
needs no Save; the explicit Save belongs to a form of several properties.

**Conductor is the one inline field with a side effect**, and the second
half of the rule applies to it unchanged: setting it claims the ticket at
the next poll and starts an agent run, so the effect is **named at the
field** — the same sentence the create dialog carries beneath its pill
row. It is still not confirmed beyond Save, because the operator chose it
at the control. The other three fields are reversible and name nothing.

`state` is deliberately **not** inline-editable. By the rule above a
transition is confirmed on its own, and a property form that commits
several fields with one Save cannot carry that confirmation. Transitions are
therefore actions that open a confirmation dialog, never a picker.

## Which components carry this

- `dialog` — the hull for every add, edit, cancel and confirm surface.
  Its `open` attribute is the state.
- `form` — the surface itself, and it owns its fields. `lines` are the two
  borderless text lines that open it, in a `title` and a `description`
  variant; `pills` is the wrapping row of property pills, and where the
  overflow control of rule 6 will live; `lead` is the separated row of
  rule 3a, and it is an object rather than an array because at most one
  property earns that emphasis. `actions` is empty where a `dialog` is the
  hull, because the hull renders its own action row.
- `page_header` — the screen's own header: what the screen is, and the
  right-aligned actions it owns, including the add action.
- `option_picker` — the property pill itself: a trigger plus an
  `option_list` popover, in a `field` variant (the pill; hidden inputs,
  writes with the form) and an `inline` variant (the bare value on a
  detail screen; writes with the property form's Save).
- `option_list` — the shared checkable list inside the popover: one panel
  markup for both the dialog and the inline case. It owns the clear row
  of rule 5, because a row of a listbox belongs to the list, and the
  create row above, for the same reason.
- `message` — the form-level refusal of level 1 above.
- `button` — the action row, and the dialog's ghost icon-only close
  control.

These carry a **Drupal form**, which is a different surface with the same
rule set, and they are deliberately not the dialog's widgets:

- `form_element` — the field wrapper: label, control, and the `errors`
  slot used for level 2 above.
- `form_input` — the bordered single-line text control.

Multi-line and single-choice form fields have **no SDC of their own** here:
`textarea` and `select_field` were deleted by BB-378 (D17) as
unreferenced, so a real Drupal form renders `#type => textarea` and
`#type => select` through Drupal's own element templates.

## States are attributes, not classes

Every open or closed state in this pattern is an **accessible attribute
rendered from a prop** — the dialog's own `open`, the picker trigger's
`aria-expanded` and `aria-controls`, the panel's `hidden` — and never a
CSS class. Two things follow. The states are announced correctly to
assistive technology, and every one of them is readable with JavaScript
disabled entirely, so the pattern can be reviewed and tested from markup
alone. The collapsible handler is additive: it flips exactly those same
attributes, and nothing depends on it having run.
