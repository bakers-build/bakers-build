@feature:ticket-detail
Feature: The ticket detail screen is one canvas inside the shell's island
  BB-414 D9. The screen a developer works in: a page_header and a
  summary-band in the canvas header, the ticket's body in main, the inspector
  beside it. The canvas is the CONTROLLER's (D1) and the view mode emits only
  the body, so "exactly one canvas per page" is the assertion that keeps the two
  halves from both drawing one.

  THE SECOND CLICK IS THE ASSERTION, as in features/team/team-islands.feature.
  A declaration lost in a fragment swap still survives the first click, so a
  one-click scenario cannot see the defect that broke this mechanism's first
  delivery (BB-408, restored as a suite by BB-396). Every navigating
  scenario here clicks TWICE.

  Background:
    Given I am logged in as "Administrator"

  # NEGATIVE CONTROLS. Three claims in this file are NEGATIVES — no tab row, no
  # filter rail, the handoff stream closed — and a detector that cannot report
  # the positive proves nothing at all. Each of these drives one detector to the
  # side the assertions never exercise, against a surface that really has the
  # thing. Without them "no tab row is present" would pass just as happily
  # against a selector with a typo in it.
  @negative-control
  Scenario: The reload detector really does see a full page load
    Given I visit the ticket "BB-142"
    When I reload the page
    Then the document was reloaded

  # The team screen HAS a tab row (IA D12.3, four tabs). Measured against it,
  # the same selector the ticket screen asserts empty comes back non-empty.
  @negative-control
  Scenario: The tab-row detector really does see a tab row
    Given I visit the team "Platform Crew"
    Then a tab row is present

  # The workspace chooser is a gate screen and carries no canvas at all, so
  # "exactly one" cannot be an accident of a selector that matches nothing
  # anywhere.
  @negative-control
  Scenario: The canvas detector really does see the absence of a canvas
    When I open the workspace chooser route
    Then no canvas is present in the document

  @shell
  Scenario: The application shell renders on the ticket route
    When I visit the ticket "BB-142"
    Then the application shell is present
    And the shell rail is present
    And the page shows "Add designbook entity view-mode for bb_ticket"

  # AC 3. The screen owns the canvas and the view mode owns only the body; two
  # canvases on one page is exactly what that split fails as.
  Scenario: The screen is exactly one canvas, with a header, a main and an inspector
    When I visit the ticket "BB-142"
    Then exactly one canvas is present in the document
    And the canvas has a header region
    And the canvas has a main region
    And the canvas has an inspector region
    And the canvas has no filter rail
    And the canvas header holds the summary band and no page header
    And the inspector region holds exactly one inspector

  Scenario: The band puts flow, summary and links in reading order
    When I visit the ticket "BB-142"
    Then the band region "flow" comes before the band region "summary"
    And the band region "summary" comes before the band region "links"

  # AC 6's grouping, observed on the surface rather than on the grouper. BB-142
  # carries six links spanning mr, ci, report, design, ddev and chat — so all
  # four groups have rows. An empty group must be ABSENT, which is what the
  # exact list asserts; TicketLinkGroupsTest covers a ticket without one.
  Scenario: The link groups that have rows are shown
    When I visit the ticket "BB-142"
    Then the band shows exactly the link groups "Code, Test results, Try it yourself, More"

  # A Slack thread permalink is a chat link: listed under More, with the inbox
  # icon, not the doc icon.
  Scenario: A Slack thread permalink is a chat row under More
    When I visit the ticket "BB-142"
    Then the link group "More" has a row for "https://example.slack.com/archives/C0123ABCD/p1700000000000100" with the icon "inbox"

  # The state flow is a list, not colour alone: exactly one step is current,
  # and it is the ticket's own state.
  Scenario: The state flow marks the ticket's state as the current step
    When I visit the ticket "BB-142"
    Then the workflow list marks the state of ticket "BB-142" as its one current step

  # A test result names its source before its counts.
  Scenario: The report row leads with its source
    When I visit the ticket "BB-142"
    Then every report row names its source before its counts

  # AC 8. The shell layout puts local_tasks_block inside the content island, so
  # a tab row is what this route would render by default; its absence is a
  # property of the screen and not of the shell.
  Scenario: There is no tab row on the ticket screen
    When I visit the ticket "BB-142"
    Then no tab row is present

  # AC 7. Last in the body, a NATIVE <details> — not a scripted accordion —
  # closed on arrival and openable.
  Scenario: The handoff stream is last in the body, closed, and opens
    When I visit the ticket "BB-142"
    Then the run history shows 3 run rows
    And every run row shows its state, its conductor and when it started
    And the run history comes before the handoff stream
    And the handoff stream is a native details element
    And the handoff stream is the last block in the main region
    And the handoff stream is closed
    When I open the handoff stream
    Then the handoff stream is open
    And every handoff time is a time element with its exact date on hover

  # AC 7's other half, and the reason collapsible.twig carries no .js file. Run
  # in the `chromium-nojs` project, where javaScriptEnabled is false — so this
  # scenario would fail the moment the component grew a scripted accordion.
  @nojs
  Scenario: The handoff stream still opens with JavaScript disabled
    When I visit the ticket "BB-142"
    Then the handoff stream is a native details element
    And the handoff stream is closed
    When I open the handoff stream
    Then the handoff stream is open

  # AC 9, and the one claim in this file whose subject does not exist in the
  # seeded world. The inspector declared `sticky top-0` from the day it was
  # written and never stuck: its containing block was the grid cell, which
  # carried `self-start` and so shrank to the aside's own height — zero travel
  # range. Nothing caught it because no ticket on this world is long enough to
  # scroll past the rail, so the scenario MANUFACTURES one.
  #
  # Both halves of the criterion are here on purpose. "It sticks" and "a picker
  # at its bottom is not clipped" pull against each other — the lazy fix for the
  # first is an `overflow` on the chain, which is precisely what breaks the
  # second — so a scenario that asserted only one would license the regression
  # of the other.
  @sticky
  Scenario: The inspector stays in view while a body taller than the viewport scrolls past
    Given the workspace has a ticket whose body is taller than the viewport
    When I visit that tall ticket
    And I expand the description
    Then the main region is at least 3000 pixels tall
    And nothing between the inspector and the document clips it
    When I scroll down 1500 pixels
    Then the page really scrolled at least 1500 pixels
    And the main region has scrolled off the top
    And the inspector is still held at the top of the viewport
    And nothing between the inspector and the document clips it
    And no handoff stream is shown
    And no run history is shown

  # AC 11's island half. TWO CLICKS, and the second one lands on markup that
  # arrived through a swap rather than through a document load: leave the ticket
  # screen by the rail, come back to it by the history the boost pushed, then
  # navigate again. If the ticket screen's fragment came back without its own
  # declaration, that last click is a full page load and the document mark dies.
  # One click could not tell the two apart.
  Scenario: Leaving the ticket screen and coming back keeps the document
    Given I visit the ticket "BB-142"
    When I click the rail entry "Platform Crew"
    Then the document was not reloaded
    And exactly one canvas is present in the document
    And the page shows "Platform Crew"
    When I go back
    Then the document was not reloaded
    And exactly one canvas is present in the document
    And the page shows "Add designbook entity view-mode for bb_ticket"
    # THE SECOND CLICK. Made from the ticket screen as a swapped-in fragment.
    When I click the rail entry "Design Crew"
    Then the document was not reloaded
    And the rail marks "Design Crew" as current
    And exactly one canvas is present in the document

  # Entity access retains its 403; a mismatched workspace path retains its 404.
  @tenancy
  Scenario: A member of only the other workspace is refused this workspace's ticket
    Given the other workspace has a project, a ticket and a member
    And I am logged in as the account "south-contributor"
    When I request the ticket "OTHER-1" in the workspace "other"
    Then the response status is 200
    And exactly one canvas is present in the document
    When I request the ticket "BB-142" in the workspace "bakers"
    Then the response status is 403
    And the error screen is 403 with the "signpost-denied" signpost

  # The same ticket, the same account that CAN see it, under a slug that does
  # not own it. This is the case the shipped Southside Bakery fixture exists
  # for, and it answers 404 — the workspace check talking, not entity access.
  @tenancy
  Scenario: A ticket asked for under a workspace that does not own it is not found
    Given the other workspace has a project, a ticket and a member
    When I request the ticket "BB-142" in the workspace "bakers"
    Then the response status is 200
    When I request the ticket "BB-142" in the workspace "other"
    Then the response status is 404
    And the error screen is 404 with the "signpost-missing" signpost
