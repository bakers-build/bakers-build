@feature:project-create
Feature: Creating a project from the projects screen
  BB-421 Task 8. Every acceptance criterion but the field-set one is
  client-side dialog behaviour, and none of it is reachable from PHP or from
  Storybook: a story never calls `Drupal.attachBehaviors`, so no story runs
  `option_picker.js`, and no kernel test can watch a pick happen or watch a
  fragment arrive in the shell's overlay.

  THE PLAN'S EXPECTED RED IS NOT OBSERVABLE FROM THIS FILE, and that is stated
  rather than papered over. The confirmed test plan says this check is "RED
  before Task 4 (no route), GREEN after"; Task 4 — the route, the form and its
  display — landed two stages before this one, so the route already answers and
  there is no commit at which these scenarios could have failed for the reason
  the plan names. What replaces that RED is a deliberate negative probe against
  the third scenario, recorded in
  `assets-ai/BB-421/node/project-create-absence-probe.txt`: the absence
  assertions were temporarily pointed at the create and clear rows the TICKET
  dialog's `labels` picker really does render, and both FAILED there — so the
  selectors match real markup and the zero this file measures on the group
  picker is a measurement rather than a typo.

  WHAT IT FOUND ON ITS FIRST RUN, which is the case for a browser gate made
  rather than argued. All three scenarios were RED against the trigger exactly
  as delivered: `ProjectCreateActionSource` declared
  `hx-select="form#bakers-project-create"` — reasoning copied from the ticket
  trigger, where the hull genuinely IS inside the form — so the swap discarded
  the generic hull that WRAPS this form. Measured in Chromium: the shell overlay
  received a bare `<form>` and the document held ZERO `<dialog>` elements, so
  there was no `open` state, no title and no `dialog__message` for a refusal to
  render into. AC 2's error would have been invisible while the POST round trip
  looked healthy, and no PHP test could see it — `ProjectCreateActionTest` was
  green on the wrong literal, because it pinned the same copied assumption. The
  trigger selects `dialog` now and that test pins the correction.

  THE HULL IS NOT THIS SURFACE'S (spec D2), which is why every selector in the
  steps binds to `dialog[data-dialog]` holding `form#bb-project-create-form`
  rather than to an id of its own. `BbProjectCreateForm` composes no hull at all:
  `island`'s `WrappedRouteRenderer` wraps the route's main content because the
  form does nothing to opt out, and the component that renders is
  `bb_theme:dialog` only because it declares `replaces: island:dialog`. The
  dialog's title is the ROUTE's `_title`, and its `message` slot is a plain
  `#type: status_messages` — which is what the second scenario reads the refusal
  out of.

  Background:
    Given I am logged in as "Administrator"
    And I am on the projects screen

  # AC 1. The whole journey: the trigger, the swap, three real picks and a
  # write that lands back on the list.
  #
  # `Given no project is named "Designbook"` is an ADDITION to the plan's
  # Gherkin, and it is the addition this suite's own README demands of every
  # mutating scenario: "a scenario that asserts absolute row counts without such
  # a precondition is single-use, and its second run looks like a regression
  # while the mechanism is fine". Here the second run would not merely look
  # wrong, it would be REFUSED — `BbProject::defaultKey()` derives `key` from
  # `name`, `key` carries a `UniqueField` constraint, and a second `Designbook`
  # therefore collides on a field this surface does not render.
  #
  # THE SECOND `When` IS NOT DECORATION. A navigating scenario clicks TWICE: a
  # declaration lost in an htmx swap still survives the first click, which is
  # the class of defect that broke this mechanism's first delivery (BB-420
  # Task 22, measured as five option pickers arriving with no
  # `data-once="bakers-option-picker"` at all). Closing the dialog here is
  # `Cancel`, which closes the hull in place because its link points at this
  # screen. The hull's other two dismissals — its close control and Escape —
  # go to the same place,
  # and both are asserted once for both surfaces in
  # `features/dialogs/create-dialog-parity.feature`. (This comment used to call
  # Cancel "the only dismissal this hull delivers", on `bb_theme:dialog`'s
  # claim that Escape-to-close "belongs to the ticket that makes these dialogs
  # interactive". That stopped being true in `c96ff93e5`, which shipped the
  # handler and the claim in one commit.)
  # The step therefore re-marks the document AFTER it lands and asserts the
  # SECOND open kept that document. Everything the scenario does afterwards is
  # done in the dialog that arrived through that swap, which is what makes the
  # picks and the submit below an operability claim and not a presence one.
  Scenario: A created project appears in the list
    Given no project is named "Designbook"
    When I open the create-project dialog
    And I close it and open it again
    Then the project form groups the Repository
    And the project form offers Branch convention "no"
    When I fill in "Designbook" as the project name
    And I pick the group "Bread"
    And I pick the team "Platform Crew"
    And I submit the create-project dialog
    Then the projects list contains "Designbook"

  # Cancel closes the hull in place and Create lands through `HX-Location`,
  # a full page load. Either way the list must stay in the frame it had, not
  # wrapped in a form canvas with an extra zone inset.
  Scenario: Cancel and Create land on the list in the frame it had
    Given no project is named "Framed"
    Then the listing sits in a single content frame
    When I open the create-project dialog
    And I cancel the create-project dialog
    Then the list edge has not moved since the last frame check
    And the listing sits in a single content frame
    When I open the create-project dialog
    And I fill in "Framed" as the project name
    And I pick the group "Bread"
    And I pick the team "Platform Crew"
    And I submit the create-project dialog
    Then the projects list contains "Framed"
    And the list edge has not moved since the last frame check
    And the listing sits in a single content frame

  # AC 2, spec D5. The refusal is the ENTITY's — `bb_project.teams` is
  # `setRequired(TRUE)` since BB-419, which on a multi-value field puts
  # `NotNull` on the item list — and the only thing this product owns is the
  # wording: the refusal reaches the widget through core's own
  # `WidgetBase::flagErrors()` path, and `PickerWidget` prefixes its own human
  # label, so the sentence reads `Teams: This value should not be null.` instead
  # of the bare constraint message an operator was shown before BB-420 Task 13.
  #
  # Observed HERE and not only in `ProjectCreateFormTest`, because the kernel
  # test reads `$form_state->getErrors()` and this scenario reads what an
  # operator actually sees: the message rendered into the generic hull's own
  # `message` slot, with the dialog still on screen and the typed name still in
  # its field. Those three facts are one round trip through htmx that no PHP
  # test performs.
  Scenario: A project without a team is refused against the team field
    When I open the create-project dialog
    And I fill in "Teamless" as the project name
    And I pick the group "Bread"
    And I submit the create-project dialog
    Then the dialog is still open
    And the message names the "Teams" field
    And the project name still reads "Teamless"

  # AC 4 AND AC 2's SECOND HALF, and this scenario is the gap that let the
  # delivery ship green. Eight gates were green at the delivery commit while
  # this surface was INOPERABLE after any refusal — 0 of 3 option pickers
  # re-attached, the `<dialog>` lost its own `data-once`, `form_build_id` was
  # gone from the document, and only a page reload escaped. Nothing saw it
  # because the scenario above stops at three presence assertions and no PHP
  # test renders a refusal at all.
  #
  # THE CAUSE WAS OURS, AND THE FIX IS TO STOP CAUSING IT.
  # `FormBuilder::prepareForm()` hangs `data-hx-swap-oob` on the rebuilt
  # `form_build_id` whenever `HX-Target` does not end in `-form` or differs from
  # `HX-Trigger`, on its own stated precondition that "the target to replace is
  # not a whole form". This surface broke that convention twice — the POST
  # targeted the shell overlay, and the form id ended in `_create` — so core
  # attached the swap while the build id was ALSO in the main swap, and htmx,
  # whose out-of-band pass runs first, wrote it over an input the main swap then
  # replaced. The first delivery answered that by stripping core's attribute back
  # off. BB-421's re-entry deleted that workaround: the POST targets the FORM
  # (`hx-target="this"`, `outerHTML`, selecting the form out of the response) and
  # the form id ends in `_form`, which is core's own htmx form path with nothing
  # of ours in it. Two consequences reach this scenario — the `<dialog>` hull is
  # never re-swapped, so it cannot lose its own behaviours; and the hull's
  # `message` slot, which sits OUTSIDE the form, is updated out of band by an
  # `hx-select-oob` the form declares.
  #
  # SO EVERY STEP AFTER THE REFUSAL IS AN OPERABILITY CLAIM, NOT A PRESENCE
  # ONE, and that is the whole point: the dialog is still there is exactly what
  # was already true while it was unusable. The scenario keeps OPERATING it —
  # it reads the blame off the offending field, checks the surface still holds
  # the one hidden input the next submit needs and that every picker got its
  # behaviour back, then really opens a panel, really picks, and really writes.
  # A recovery that succeeds is the only assertion that cannot be satisfied by
  # a broken dialog.
  #
  # NO SECOND `When I close it and open it again` HERE. That rule exists
  # because a declaration lost in a swap survives the FIRST click; this
  # scenario's refusal round trip IS a second swap into the same overlay, and
  # the picks below happen in the dialog that arrived through it.
  #
  # `Given no project is named "Recovered"` for the reason the first scenario
  # states: `BbProject::defaultKey()` derives `key` from `name` and `key`
  # carries a `UniqueField` constraint, so a second run would be REFUSED on a
  # field this surface does not render — and this scenario ends in a real write.
  Scenario: A refused submit leaves the dialog operable and recoverable
    Given no project is named "Recovered"
    When I open the create-project dialog
    And I fill in "Recovered" as the project name
    And I submit the create-project dialog
    Then the dialog is still open
    And the "Teams" field is blamed for the refusal
    And the project name still reads "Recovered"
    And the create-project dialog is still operable
    When I pick the group "Bread"
    And I pick the team "Platform Crew"
    And I submit the create-project dialog
    Then the projects list contains "Recovered"

  # AC 3's negative half, and spec D7 stated as a scenario so that the ticket
  # which wires a create row has to CHANGE one rather than silently widen this
  # surface. `create_label` is empty on `group_id`, which is how
  # `PickerWidget::pickerProps()` says a field offers no create row, and
  # `clear_label` is empty too — the clear row's absence is what makes
  # `group_id` un-un-pickable, so one panel answers both halves.
  #
  # IT IS THE SCENARIO THAT CAN PASS VACUOUSLY, so both absence steps assert
  # the panel's POSITIVE content first, from the same measured selector
  # (`[role="option"]` rows carrying `.option-list__label`) the pick steps use.
  # An absence assertion aimed at a panel that never opened, or at a selector
  # that matches nothing anywhere, passes by asserting nothing. The recorded
  # probe named in this file's header is the other half of that proof.
  Scenario: The group picker offers only groups that exist
    When I open the create-project dialog
    And I open the group picker
    Then the panel lists "Bread"
    And the panel offers no create row
    And the panel offers no clear row


  # AC 11, and the only finding of the review seat that was a silent WRONG
  # ANSWER rather than a missing assertion: a 2xx response that does not
  # contain this form empties the surface with no message anywhere.
  #
  # THE MECHANISM. The form's swap is `hx-select="form#<its id>"` with
  # `outerHTML` on itself — core's native htmx form shape, which is what keeps
  # the rebuilt `form_build_id` inside the main swap — and `hx-select` matching
  # NOTHING makes `swapOuterHTML()` remove the target with no replacement
  # (`htmx.js:1698-1724`). The other status classes need no guard and are not
  # what this measures: 4xx and 5xx never swap (`responseHandling` sets
  # `swap: false`), and the success path returns before any swap because it
  # answers an empty 200 plus `HX-Location`.
  #
  # THE RESPONSE IS MOCKED, THE BEHAVIOUR IS NOT, and the step's own docblock
  # carries the measurement behind that choice: the obvious live route — a
  # session that ended — answers 404 on this url rather than the
  # 302-into-a-200 the guard defends against, so a scenario built on it would
  # pass while exercising nothing. What is under test here is client-side, so
  # the response is the INPUT to the behaviour and supplying it directly is the
  # ordinary way to reach the branch.
  #
  # TWO `Then`s BECAUSE THE DECISION HAS TWO HALVES, and until the review of
  # 2026-09-09 only the first was asserted while a step docblock claimed both.
  # Removing the hull is what stops the silent wrong answer; going to where the
  # answer came from is what turns it into an answer at all. A hull correctly
  # removed with no navigation leaves the operator on the screen they started
  # from, with a submit that produced nothing and nothing to read — which is the
  # same silence in a quieter form.
  Scenario: A response without this form does not silently empty the dialog
    When I open the create-project dialog
    And I fill in "Guarded" as the project name
    And the next submit is answered without this form
    And I submit the create-project dialog
    Then the dialog is not left empty
    And the browser was taken to where that answer came from
