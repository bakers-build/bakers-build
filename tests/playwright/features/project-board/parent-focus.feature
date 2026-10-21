@project-board @feature:board-parent-focus
Feature: Project Board parent focus and summary
  A member focuses the Board on one parent ticket via its chip and reads the
  summary chips of the open selection. The Done work-state chip reveals the
  Done column of closed work. The cards below are the tickets; merged work is
  the Done column.
  Each scenario builds its own project and accounts (the JS and no-JS projects
  run in parallel), so the names below are suffixed per scenario by the steps.

  Background:
    Given the ticket index is up to date
    And I am signed in as a member of the "bakers" workspace
    And a Board project has a parent with 12 tickets for "board-alice", 2 for "board-bob" and 1 unassigned

  Scenario: Focusing on a parent counts every open descendant
    When I visit the focus Board
    And I choose the focus parent
    Then the Board summary counts "board-alice · 12, board-bob · 2, Unassigned · 1, Qualification · 15, No priority · 15"
    And the Board summary does not say "Last merged"
    And the Board summary counts are chips
    And the "Not assigned" column shows 10 cards
    And the Parent chips offer the focus parent
    And the Parent chips offer "Closed-child parent"
    And the Parent chips do not offer "Focus leaf"
    And the Parent chips do not offer "Closed parent"
    And the Parent chips do not offer "Cancelled parent"

  Scenario: The Done chip keeps the parent, survives reload and drops on back
    When I visit the focus Board
    And I choose the focus parent
    And I click the work-state chip "Done"
    Then the address carries "work_state[3]=done"
    And the address carries "parent_id="
    And the address does not carry "page="
    And the Board shows the columns "Not assigned, Intake, Working, Done"
    And the "Done" column shows 2 cards
    And the Board summary counts "board-alice · 12, board-bob · 2, Unassigned · 3, Qualification · 15, Cancelled · 2, No priority · 17, Done · 2"
    When I reload the page
    Then the "Done" column shows 2 cards
    When I go back
    Then the Board shows the columns "Not assigned, Intake, Working"
    And the address does not carry "work_state"

  Scenario: Counts stay fixed on a later page
    When I visit the focus Board
    And I choose the focus parent
    When I open the next "Not assigned" page
    Then the "Not assigned" column shows 5 cards
    And the Board summary counts "board-alice · 12, board-bob · 2, Unassigned · 1"

  Scenario: A leaf parent is an empty selection and an unknown one is refused
    When I visit the focus Board focused on its leaf
    Then the "Not assigned" column shows 0 cards
    When I visit the focus Board with an unknown parent
    Then the Board summary says "Parent ticket is unavailable."
    And the "Not assigned" column shows 0 cards

  Scenario: A project without eligible parents has no parent chips
    When I visit the empty Board
    Then the Parent chips are absent
    And the Board shows the columns "Not assigned, Intake, Working"

  Scenario: The Board tabs still navigate after focusing
    When I visit the focus Board
    And I choose the focus parent
    And I click the tab "Overview"
    Then the tab "Overview" is current
    When I click the tab "Board"
    Then the tab "Board" is current
    And the address does not carry "parent_id"
    When I click the tab "Overview"
    And I click the tab "Board"
    Then the tab "Board" is current
    And the "Not assigned" column shows 10 cards

  Scenario: Search is not a Board filter
    When I visit the focus Board focused on its parent with a search query
    Then the "Not assigned" column shows 10 cards
    And the Board has no search field

  @nojs
  Scenario: A focused Board address renders without JavaScript
    Given JavaScript is disabled
    When I open the focus Board focused on its parent
    Then the Board summary counts "board-alice · 12, board-bob · 2, Unassigned · 1"
    And the "Not assigned" column shows 10 cards
    And the Board summary counts are chips
    When I click the work-state chip "Done"
    Then the address carries "work_state[3]=done"
    And the "Done" column shows 2 cards
    And the Board summary counts "board-alice · 12, board-bob · 2, Unassigned · 3, Done · 2"
