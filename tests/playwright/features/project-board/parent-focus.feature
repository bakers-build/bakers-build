@project-board @feature:board-parent-focus
Feature: Project Board parent focus and summary
  The Parent picker of the filter bar, or a parent_id in the Board address,
  focuses the Board on one parent ticket's open descendants: the Parent chip, the assignee avatars and the open total
  count inside that focus. Show done opens the Done column of closed work.
  Each scenario builds its own project and accounts (the JS and no-JS projects
  run in parallel), so the names below are suffixed per scenario by the steps,
  and signs in as its own viewer, because Done open or closed is stored with
  the account.

  Background:
    Given the ticket index is up to date
    And a Board project has a parent with 12 tickets for "board-alice", 2 for "board-bob" and 1 unassigned
    And I am signed in as the focus Board's viewer

  Scenario: Focusing on a parent counts every open descendant
    When I open the focus Board focused on its parent
    Then the Board shows the focus parent chip counting 15
    And the Board reads "15 of 15 open tickets"
    And the Board assignees count "board-alice · 12, board-bob · 2, Unassigned · 1"
    And the "Not assigned" column shows 10 cards

  Scenario: A parent is chosen in the filter bar and removed by its chip
    When I visit the focus Board
    And I choose the focus parent in the Board filter bar
    Then the Board shows the focus parent chip counting 15
    And the Board reads "15 of 15 open tickets"
    When I remove the Board's Parent filter
    Then the address does not carry "parent_id"
    And the Board shows no active filter

  Scenario: Show done keeps the parent and survives reload
    When I open the focus Board focused on its parent
    And I click "Show done" in the Done column
    Then the address carries "done=show"
    And the address carries "parent_id="
    And the address does not carry "page="
    And the Board shows the columns "Not assigned, Intake, Working, Done"
    And the "Done" column shows 2 cards
    When I reload the page
    Then the "Done" column shows 2 cards
    And the Board shows the focus parent chip counting 15

  Scenario: Counts stay fixed on a later page
    When I open the focus Board focused on its parent
    And I open the next "Not assigned" page
    Then the "Not assigned" column shows 5 cards
    And the Board assignees count "board-alice · 12, board-bob · 2, Unassigned · 1"
    And the Board reads "15 of 15 open tickets"

  Scenario: A leaf parent is an empty selection and an unknown one is refused
    When I visit the focus Board focused on its leaf
    Then the "Not assigned" column shows 0 cards
    When I visit the focus Board with an unknown parent
    Then the Board summary says "Parent ticket is unavailable."
    And the "Not assigned" column shows 0 cards

  Scenario: The Board tabs still navigate after focusing
    When I open the focus Board focused on its parent
    And I click the tab "Overview"
    Then the tab "Overview" is current
    When I click the tab "Board"
    Then the tab "Board" is current
    And the address does not carry "parent_id"
    When I click the tab "Overview"
    And I click the tab "Board"
    Then the tab "Board" is current
    And the "Not assigned" column shows 10 cards

  @nojs
  Scenario: A focused Board address renders without JavaScript
    Given JavaScript is disabled
    When I open the focus Board focused on its parent
    Then the Board assignees count "board-alice · 12, board-bob · 2, Unassigned · 1"
    And the "Not assigned" column shows 10 cards
    And the Board shows the focus parent chip counting 15
    When I click "Show done" in the Done column
    Then the address carries "done=show"
    And the "Done" column shows 2 cards
    And the Board shows the focus parent chip counting 15
    When I remove the Board's Parent filter
    Then the address does not carry "parent_id"
