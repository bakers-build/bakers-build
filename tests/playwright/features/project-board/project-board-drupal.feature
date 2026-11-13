@project-board
Feature: Project Board Drupal
  The operational Board is a Views page of independently paged lifecycle
  columns under one filter bar, with the project's active conductors below.
  Done keeps the last seven days and opens on request; Details splits Working
  by state. Both choices are stored with the account, so each scenario builds
  a disposable project world and signs in as its own lead.

  Scenario: The Board has one filter bar with search
    Given a project world with these tickets:
      | ticket           | state         | conductor |
      | Not yet assigned | qualification |           |
      | Broken build     | working       | Oven A    |
      | Open question    | qualification | Oven A    |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the Board filter bar offers "Search, State, Priority, Assignee, Details"
    And the Board shows no Conductor filter
    And the Board shows the columns "Not assigned, Intake, Working, Done"
    When I search the Board for "Broken"
    Then the address carries "search=Broken"
    And the Board shows only the tickets "Broken build"
    And the Board shows the active filter "Search is Broken · 1"
    And the Board reads "1 of 3 open tickets"

  Scenario: An active filter shows as a chip with its count
    Given a project world with these tickets:
      | ticket        | state         | conductor | priority |
      | Urgent fix    | working       | Oven A    | 1        |
      | Urgent review | review        | Oven A    | 1        |
      | Routine chore | qualification | Oven A    | 3        |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the Board shows no active filter
    And the Board reads "3 of 3 open tickets"
    When I choose "High" in the "Priority" facet
    Then the Board shows the active filter "Priority is High · 2"
    And the Board reads "2 of 3 open tickets"
    And the Board shows only the tickets "Urgent fix, Urgent review"
    When I remove the "Priority" chip
    Then the Board shows no active filter
    And the Board reads "3 of 3 open tickets"

  Scenario: Details splits Working by state and is remembered in another session
    Given a project world with these tickets:
      | ticket        | state   | conductor |
      | Planning      | plan    | Oven A    |
      | Building      | working | Oven A    |
      | Building more | working | Oven A    |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the "Working" column shows the tickets "Planning, Building, Building more"
    And the "Working" column holds no state columns
    When I choose "States" in the Board details
    Then the "Working" column holds the state columns "plan 1, working 2"
    And the "Working" column header reads "empty: review"
    When I click "Show done" in the Done column
    Then the Done column is open
    When I open the world project Board in another browser session
    Then the "Working" column holds the state columns "plan 1, working 2"
    And the Done column is open

  Scenario: Done shows the last 7 days until Show older
    Given a project world with these tickets:
      | ticket           | state     | closed |
      | Shipped recently | done      | 2      |
      | Dropped recently | cancelled | 1      |
      | Shipped long ago | done      | 9      |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the Done column is closed
    When I click "Show done" in the Done column
    Then the Done column is open
    And the Done column reads "last 7 days"
    And the "Done" column shows the tickets "Shipped recently, Dropped recently"
    And the card "Dropped recently" reads "Cancelled"
    When I click "Show older" in the Done column
    Then the "Done" column shows the tickets "Shipped recently, Dropped recently, Shipped long ago"
    When I click "Hide done" in the Done column
    Then the Done column is closed

  Scenario: A blocked ticket waits in Intake marked Blocked by
    Given a project world with these tickets:
      | ticket             | state   | conductor | blocked by |
      | Blocker            | working | Oven A    |            |
      | Waiting on blocker | plan    | Oven A    | Blocker    |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the "Intake" column shows the tickets "Waiting on blocker"
    And the card "Waiting on blocker" is blocked by "Blocker"

  Scenario: Cards show their runs and the latest run
    Given a project world with these tickets:
      | ticket       | state   | conductor | runs                     |
      | Retried work | working | Oven A    | done, done, done, failed |
      | First try    | working | Oven A    | done                     |
      | Fresh work   | working | Oven A    |                          |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the card "Retried work" reads "4 runs - last failed"
    And the card "First try" reads "1 run - last done"
    And the card "Fresh work" reads no runs

  Scenario: Active conductors are listed below the Board
    Given a project world with these tickets:
      | ticket   | state   | conductor |
      | Building | working | Oven A    |
    And I am signed in as the world's lead
    When I open the world project Board
    Then the Active conductors are "not affected by ticket filters"
    And the Active conductors list:
      | conductor | active tickets | load                |
      | Oven A    | 1              | 0 / 2 parallel runs |
      | Oven B    | 0              | Unknown capacity    |

  Scenario: The machine account cannot open the Board
    Given I am signed in as "fixture-api-machine"
    When I visit the project board for "bakers.build Platform"
    Then the project board denies access

  @deployment-presentation
  Scenario: Board badges appear only once the deployment is closed
    Given a project world with these tickets:
      | ticket     | state         |
      | First work | qualification |
    And the world has an open deployment to "develop" carrying "First work"
    And the account "north-lead" is seated in the world as a lead
    And I am signed in as "north-lead"
    When I open the world project Board
    Then the board card "First work" does not show the deployed badge "develop"
    When the world deployment is closed
    And I open the world project Board
    Then the board card "First work" shows the deployed badge "develop"
