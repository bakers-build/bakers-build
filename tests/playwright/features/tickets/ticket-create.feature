@feature:ticket-create
Feature: The create-ticket dialog's pickers write the values the form submits
  BB-420 Task 4 delivered the server half: `BbTicketCreateForm` reads
  every one of the eight fields through the hidden inputs `option_picker.twig`
  already renders, and a cleared field is an absent key rather than an empty
  one. No PHP test can watch a pick happen — Storybook never calls
  `Drupal.attachBehaviors`, so no story runs this theme's behaviours either —
  which is why this file exists at all.

  BB-420 Task 24 CHANGED HOW EVERY SCENARIO BELOW OPENS THE DIALOG, and the
  change is not cosmetic. `?create=ticket` was the island host's gate: it made
  the shell's overlay slot render the dialog on whatever screen carried the
  parameter. There is no island and no such parameter now — the dialog is a
  ROUTE, `/{workspace}/ticket/create` — so the only way in is the trigger,
  which is what the shared `Given` step clicks. Opening by URL is still
  possible, but the URL is the dialog's own address and lands on a standalone
  page rather than over the list; the `@nojs` scenario is the one that asserts
  that, deliberately.

  Scenario: Picking a conductor sets the value the form will submit
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I open the "Conductor" picker
    And I pick the option "cw-framework"
    Then the "Conductor" pill reads "cw-framework"
    And the form will submit "conductor_id" as "cw-framework"

    # AC3's client half: a cleared field is an ABSENT key, not an empty one.
    # The picker's hidden input for "conductor_id" must be gone entirely —
    # zero inputs, not one carrying an empty value — which is the whole of the
    # "unset" contract the form on the server reads by.
    #
    # NAMED `conductor_id` SINCE BB-420 Task 17, and the rename is the point
    # rather than a detail: the field is collected by a real widget now, so
    # the name on the wire IS the entity's own field name. There is no longer
    # a form-side table relating the two, which is exactly what that task
    # deleted.
    When I open the "Conductor" picker
    And I clear the "Conductor" picker
    Then the form will submit nothing for "conductor_id"

  # BB-420 Task 6: the trigger that opens this dialog from the ticket list
  # itself — the POSITIVE side of BB-332's conditional, owned by the
  # content header rather than by the shell chrome (ticket-list scene).
  #
  # Deviates from the task brief's sketch in one way, stated rather than
  # hidden: the brief's second click follows "I press Escape", and this
  # scenario clicks the trigger twice instead. When it was written that was
  # because Escape-to-close did not exist; the comment here said so, citing
  # `bb_theme:dialog`'s own docblock on it belonging "to the ticket that
  # makes these dialogs interactive". Both halves are stale — `c96ff93e5`
  # shipped the handler, and BB-421's re-entry moved it into `island` and
  # fixed the focus bug that kept it from firing — so Escape is now asserted
  # for BOTH surfaces in `features/dialogs/create-dialog-parity.feature`.
  # What this scenario keeps is the property the global constraint actually
  # requires — the SECOND click lands on markup that arrived through a
  # swap, not on the page's first paint — proved by clicking the
  # same trigger twice in a row: the trigger's own container targets
  # ITSELF (`TicketCreateActionSource` — nesting it under `#island-content`
  # would have detached it from the very swap it caused, see that class's
  # docblock), so the FIRST click already replaces the small container the
  # trigger itself lives in, and the second click is made on that
  # replacement.
  #
  # WHERE THE TRIGGER LIVES, and it has now moved twice. It was an island
  # plugin (`TicketList`), then a controller (`BbTicketListController`),
  # and the ticket list's own delivery deleted both — on 2026-09-03 with the
  # screen's island host, on 2026-09-04 when the tickets VIEW took its route
  # back and began composing `bb_theme:canvas` itself through a
  # `display_builder` sources tree. It is now a ui_patterns SOURCE placed
  # from that same tree, in the canvas's `header` slot. What the scenario
  # below observes is unchanged by all three homes, which is why its steps
  # never moved.
  #
  # WHAT THE CLICK COSTS, RE-MEASURED AFTER BB-420 Task 24. It used to fall
  # through to an ORDINARY, WHOLE-PAGE render — `island.host_resolver` could
  # resolve neither the trigger's own container id nor, therefore, the overlay
  # it named as an out-of-band peer, so `IslandGetSubscriber::fragments()`
  # returned `[]` and the header was sent and IGNORED. htmx then extracted a
  # small container and the dialog client-side out of ~158 KB.
  #
  # The click is now a GET of the dialog's own route through
  # `?_wrapper_format=island_dialog`, and the response is the wrapped form and
  # nothing else. The open question that used to sit here — whether to register
  # an island host for a screen BB-413 deliberately left without one — is
  # closed by not needing one.
  Scenario: The list's own add action opens the dialog over it
    Given I am logged in as "Administrator"
    When I visit the project's own ticket list
    Then the create-ticket dialog is not present
    When I click the "New ticket" action
    Then the document was not reloaded
    And the create-ticket dialog is present
    # THE SINGLE-TARGET CLAIM, on the delivered DOM. The response settles ONE
    # element — the shell's overlay container — which is what makes core's htmx
    # bridge attach the dialog's behaviours to the subtree that actually
    # arrived. Two settled elements is the shape it gets wrong.
    And the dialog is inside the shell overlay
    And the dialog carries the list's project with no editable picker
    # THE SECOND CLICK. The trigger is no longer part of the swap it causes —
    # it targets the overlay and declares no peer — so this click is made on
    # the page's original trigger, and what it must prove is that a second
    # fetch into an already-filled overlay still answers with a working dialog.
    When I click the "New ticket" action
    Then the document was not reloaded
    And the create-ticket dialog is present

  # THE SCREEN AN OPERATOR ACTUALLY LANDS ON, added by BB-420's review round.
  #
  # BB-315 split the ticket list into two Views displays and the create
  # action was composed into `page_1`'s canvas header only — `/tickets/all`,
  # the find-a-ticket table. The navigation home is `my_work`, `/tickets`, and
  # it carried no `header` slot at all: no title, no action, and therefore no
  # way to file a ticket from the screen the operator is put on. AC1 ("a ticket
  # can be created from the web UI") was met on a screen an operator has to go
  # looking for.
  #
  # The action is the SAME ui_patterns source on both displays
  # (`bb_ticket_create_action`), so what is worth observing here is not that
  # the source works — the scenarios above already prove that — but that this
  # display now carries it and that it behaves the same way when it does.
  #
  # CLICKED TWICE, per BB-408's rule: the trigger targets the overlay and
  # declares no out-of-band peer, so the second click lands on the page's
  # original trigger and must still answer with a working dialog into an
  # already-filled overlay.
  Scenario: The My work screen's own add action opens the dialog over it
    Given I am logged in as "Administrator"
    When I visit the My work list
    Then the create-ticket dialog is not present
    When I click the "New ticket" action
    Then the document was not reloaded
    And the create-ticket dialog is present
    And the dialog is inside the shell overlay
    When I click the "New ticket" action
    Then the document was not reloaded
    And the create-ticket dialog is present

  # BB-420 Task 22 — THE JOURNEY A USER ACTUALLY TAKES, and the blind spot
  # that let a non-functional dialog ship green.
  #
  # This file exercised two DISJOINT halves of one journey. The scenario above
  # clicked the trigger and asserted the dialog was PRESENT; every scenario
  # below picked values and submitted, and all of them opened the dialog BY URL
  # (`?create=ticket`, the shared `Given` step's opener at the time). So no
  # scenario had ever picked a value in a dialog that arrived through the
  # trigger — 37/37 was true and reassured about the wrong thing. MEASURED: the
  # trigger-opened dialog's five option pickers carried NO
  # `data-once="bakers-option-picker"` at all, nothing could be picked, and the
  # submit stayed disabled forever, while the same dialog opened by URL had all
  # five. See `web/modules/custom/island/js/island.behaviors.js` for the cause —
  # core's htmx bridge reads `detail.elt` after htmx has already advanced it, so
  # every settled element but the LAST loses its behaviours, and htmx settles
  # out-of-band peers first.
  #
  # BB-420 Task 24 REMOVED THE CAUSE rather than working around it: the
  # trigger declares no out-of-band peer at all now, so exactly one element
  # settles and the bridge's early and late reads cannot disagree. The blind
  # spot is closed a second way too — the shared `Given` step opens THROUGH the
  # trigger, because there is no longer a URL that opens the dialog over the
  # list, so every scenario in this file crosses the boundary this one was
  # written to cross.
  #
  # WHY THE STEPS ARE IN THIS ORDER. The claim is not "the dialog is present"
  # (that is the scenario above) but "the dialog is OPERABLE", so the first
  # thing asserted after the click is that the submit is already enabled with
  # no pick required — BB-664 bound the project server-side, so there is no
  # "Project" picker left to open at all; opening the "Conductor" picker below
  # is now the earliest, cheapest observation of the defect this scenario
  # exists to catch.
  #
  # NO SECOND CLICK ON THE TRIGGER. BB-408's two-click rule is discharged for
  # this trigger by the scenario above, which clicks it twice and asserts the
  # document each time; repeating it here would test that again and this
  # scenario's own subject — a pick, and a write, in a swapped-in dialog — not
  # at all.
  Scenario: The dialog the list's own action opens is a working dialog
    Given I am logged in as "Administrator"
    And the conductor "cw-framework" exists
    When I visit the project's own ticket list
    And I click the "New ticket" action
    Then the create-ticket dialog is present
    And the submit is enabled
    And the dialog carries the list's project with no editable picker
    And the dialog shows no text-format help
    When I type "A ticket filed through the list add action" into the title line
    And I open the "Conductor" picker
    And I pick the option "cw-framework"
    Then the "Conductor" pill reads "cw-framework"
    When I submit the dialog
    Then the dialog closed
    And the ticket list shows "A ticket filed through the list add action"
    And the stored ticket has conductor "cw-framework"


  # NEGATIVE CONTROL. "the dialog is not present" must be able to report the
  # positive, or a typo in the selector passes every absence assertion here.
  @negative-control
  Scenario: The dialog detector really does see a dialog
    Given I am logged in as "Administrator"
    When I open the create-ticket dialog from the ticket list
    Then the create-ticket dialog is present

  Scenario: The dialog is the agreed grammar
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    Then the dialog head is empty
    And the dialog has exactly one submit and one cancel
    And the dialog has no assignee control
    And "workflow" has a labelled group alongside the text lines
    And the peer pills are exactly "parent_id, blocked_by, conductor_id, labels, recipe, ticket_type"
    And no pill renders a bare dash
    And the dialog shows no text-format help
    And every picker menu in the dialog opens inside the dialog

  # AC 4. Named, not confirmed — the row "Create, conductor set — no, named".
  # Submitted for real (the design's own affordance for this row), and the
  # "no confirmation dialog" half is independent of the note's own rendering —
  # no code path in this surface ever calls window.confirm(), so that holds
  # whether or not the note itself renders.
  #
  # GREEN as of Task 11, Ruling R21 (see the feature header's own account of
  # the fix): the note is now always in the DOM, `hidden` until a pick,
  # and `option_picker.js` reveals it on exactly this click.
  Scenario: Setting a conductor names its effect and asks nothing
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I open the "Conductor" picker
    And I pick the option "cw-framework"
    Then a note beneath the pill row names the agent run on "cw-framework"
    When I type "Conductor effect named" into the title line
    And I submit the dialog
    Then no confirmation dialog opened

  # BB-420 Task 11, fix round 1, Finding 2: Ruling R21's second explicit
  # requirement ("the note must also disappear again when the conductor is
  # cleared") had NO coverage. The scenario above never clears; the only
  # conductor-clear scenario ("Clearing the conductor leaves the ticket
  # waiting for a human", below) never picks first, so it cannot observe a
  # shown note going hidden again. This scenario runs the whole arc on its
  # own: pick, assert the note is VISIBLE (not merely attached — see the
  # step's own comment for why that distinction is the point) and names the
  # right conductor, clear, assert it is hidden again.
  Scenario: Clearing the conductor after setting it hides the note again
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I open the "Conductor" picker
    And I pick the option "cw-framework"
    Then a note beneath the pill row names the agent run on "cw-framework"
    When I open the "Conductor" picker
    And I clear the "Conductor" picker
    Then the note beneath the pill row is hidden again

  # AC 1 and AC 3's first half.
  #
  # GREEN as of fix round 1 (commit 2187c6bf8): the submit-path defect that
  # kept this RED is fixed, so the write now reaches the server for real.
  Scenario: A ticket created with a conductor is claimed at the next poll
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I type "Retire the Gin-era ticket components" into the title line
    And I open the "Conductor" picker
    And I pick the option "cw-framework"
    And I submit the dialog
    Then the dialog closed
    And the ticket list shows "Retire the Gin-era ticket components"
    And the stored ticket has conductor "cw-framework"
    And the stored ticket is in its workflow's first state

  # AC 3's second half, read off the ENTITY and not off the form.
  #
  # GREEN as of fix round 1, same fix as above.
  Scenario: Clearing the conductor leaves the ticket waiting for a human
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I type "A ticket that waits" into the title line
    And I open the "Conductor" picker
    And I pick the clear row "No conductor"
    And I submit the dialog
    Then the stored ticket has no conductor

  # Bypass only browser validation to verify Drupal server errors and recovery.
  Scenario: A refused write keeps every typed value
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I type "The description survives" into the description line
    And I open the "Conductor" picker
    And I pick the option "cw-framework"
    And I submit the ticket dialog without browser validation
    Then the dialog is still present
    And a form-level error is shown above the body
    And the title line still reads ""
    And the description line still reads "The description survives"
    And the "Conductor" pill still carries its value
    And the document was not reloaded
    # THE SECOND CLICK. Made on the submit button that arrived through the
    # swap the first refusal caused — still refused, still preserved.
    When I submit the ticket dialog without browser validation
    Then the dialog is still present
    And the description line still reads "The description survives"
    And the "Conductor" pill still carries its value
    And the document was not reloaded

    # Drupal clears the field error after a corrected submission.
    When I type "Filed after the refusal" into the title line
    And I submit the dialog
    Then the dialog closed

  Scenario: A refused submit leaves the create-ticket dialog operable
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I open the "Conductor" picker
    And I pick the option "cw-framework"
    And I submit the ticket dialog without browser validation
    Then the dialog is still present
    And a form-level error is shown above the body
    And the create-ticket dialog is still operable
    And the document was not reloaded
    When I type "Recovered after a refused create-ticket submit" into the title line
    And I submit the dialog
    Then the dialog closed
    And the ticket list shows "Recovered after a refused create-ticket submit"

  # AC 2 observed on the wire rather than on the result. Independent of the
  # MEASURED defect above: the assertion reads the REQUEST this client sent,
  # not what the server did with it.
  Scenario: The submitted request carries no server-owned field
    Given I am logged in as "Administrator"
    And I open the create-ticket dialog from the ticket list
    When I type "A ticket" into the title line
    And I submit the dialog
    Then the submitted request carried no "identifier", "number", "state", "branch_name", "base_branch" or "owner_user_id"

  # BB-420 Task 24 CHANGED WHAT THIS SCENARIO CLAIMS, and the change was an
  # operator decision taken knowingly rather than a consequence discovered when
  # the scenario went red.
  #
  # It used to assert that `?create=ticket` on the ticket list renders the
  # dialog OVER the list, server-side, in one ordinary page load. That is gone
  # with the island: the parameter was the island host's gate, and there is no
  # host. The trigger is now an ordinary link to the dialog's own route, so a
  # browser with no JavaScript NAVIGATES and gets a standalone page.
  #
  # WHAT SURVIVES IS THE FORM, AND THE HULL NO LONGER DOES — amended by the
  # operator ruling of 2026-09-08, and this is the named cost of that ruling
  # rather than a defect found afterwards.
  #
  # This scenario used to assert that the scriptless page carries the SAME
  # `<dialog>` the htmx path does, because the hull was composed by
  # `bb-ticket-create.html.twig` — the form's own template, which core's
  # ordinary HTML renderer reaches whether or not the wrapper format is in
  # play. Under the ruling both create dialogs take `island`'s generic hull,
  # that template is deleted, and the hull is built by the WRAPPER FORMAT — a
  # main-content renderer core selects from `?_wrapper_format=island_dialog`
  # and which therefore never runs on this path at all. So the scriptless page
  # is now the form alone.
  #
  # WHAT AN OPERATOR CAN STILL DO IS UNCHANGED, which is why this is a cost and
  # not a regression: the route answers, the fields render, and the one submit
  # and one Cancel are both there, so a ticket can be filed with scripts off.
  # What is gone is the dialog chrome around it. The create-project dialog has
  # always behaved exactly this way on this path, which is the parity the ruling
  # asked for. Restoring a scriptless hull would mean a second composition to
  # keep in step with the first — the thing the ruling exists to remove — so it
  # is a follow-up if it is wanted at all.
  #
  # `And the dialog head is empty` is DROPPED rather than inverted: there is no
  # head on this path, so the assertion has no subject. The head's emptiness on
  # the htmx path is still asserted by the scenarios above.
  #
  # The trigger is FOLLOWED rather than clicked: with scripts off a click is a
  # navigation, and following the href is the same act stated in a way this
  # harness can perform in a page it has no scripts in.
  @nojs
  Scenario: The create-ticket route is a working page with JavaScript disabled
    Given I am logged in as "Administrator"
    When I visit the ticket list with "create=ticket"
    Then the create-ticket dialog is not present
    When I follow the "New ticket" action
    Then the page is the create-ticket route
    And the create-ticket form is present with exactly one submit and one cancel
    And no dialog hull is rendered around it

  # A screen without project context (`/tickets/all` carries no
  # `bb_project` route parameter and no `?project=`) binds nothing, so the
  # dialog offers the project picker instead of the conductor: conductor
  # candidates depend on the project, and the ticket is created unassigned.
  Scenario: A project-less screen's dialog offers the project picker back
    Given I am logged in as "Administrator"
    When I visit the ticket list
    And I click the "New ticket" action
    Then the create-ticket dialog is present
    And the dialog offers an editable project picker
    And the peer pills are exactly "project_id, parent_id, blocked_by, labels, recipe, ticket_type"
    When I type "Filed from a project-less screen" into the title line
    And I open the "Project" picker
    And I pick a project option
    And I submit the dialog
    Then the dialog closed
    And the stored ticket belongs to the picked project
    And the stored ticket has no conductor
