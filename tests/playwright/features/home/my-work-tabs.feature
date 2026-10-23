# BB-481 — My work gained a tab row: Tickets (the page it already opened on)
# and Stats.
#
# A tab in this shell is an ORDINARY LINK, not a JavaScript swap, so no island
# is added by this ticket; the existing content island is what keeps the
# document. That is exactly why the behaviour has to be asserted in a browser:
# no PHP test and no Storybook story can observe whether a click kept the
# document or replaced it.
#
# EVERY NAVIGATING SCENARIO CLICKS TWICE. The first click proves the mechanism
# fired once; the second proves the declaration SURVIVED the swap. A fragment
# that arrives without its own hx-* declaration still boosts the first click
# and falls back to a full load on the second, so a single-click scenario is
# green against precisely the defect this suite exists to catch.
Feature: My work carries Tickets and Stats as tabs

  Background:
    Given I am logged in as the account "north-lead"

  # Tickets stays the page My work opens on: the tab row was added to the
  # existing address rather than moving anyone to a new one.
  Scenario: My work still opens on Tickets, now with a tab row
    When I open the site root
    Then the address is "/bakers/tickets"
    And the tab "Tickets" is current
    And the My work tabs are "Tickets, My time, Stats"
    And the application shell is present

  Scenario: Stats is reachable by its own URL
    When I visit My work tab "Stats"
    Then the tab "Stats" is current
    And the address ends with "/stats"
    And the application shell is present
    And the shell rail is present

  # The real assertion is the SECOND click of each pair.
  Scenario: Switching between Tickets and Stats keeps the document
    Given I visit My work
    When I click the tab "Stats" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request
    And the document was not reloaded
    When I click the tab "Tickets" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request
    And the document was not reloaded

  # The figures themselves, read from the server rather than computed here.
  # Asserting a heading rather than a number: the counts depend on the seeded
  # world, the SHAPE does not.
  Scenario: The Stats tab renders the signed-in user's own figures
    When I visit My work tab "Stats"
    Then the Stats tab shows a figure

  @period-filter
  Scenario: Stats period filters preserve context while updating values
    Given I visit My work tab "Stats" with query parameter "unrelated" set to "preserved"
    Then the Stats period filters are accessible links
    When I choose the Stats period "30 days"
    Then the selected Stats period is "30 days"
    And the Stats period selection preserves the route and unrelated query parameter "unrelated" with value "preserved"
    And the Stats figures keep their ordered applicability
    And the Stats period fixture displays 2 closed tickets
