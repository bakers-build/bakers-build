@project-board
Feature: Project Board Drupal
  The operational Board is a Views page of independently paged lifecycle columns.
  Done stays hidden until its work-state chip is on.

  Scenario: The Board tab shows three lifecycle columns until Done is enabled
    Given the ticket index is up to date
    And I am signed in as a member of the "bakers" workspace
    When I visit the project board for "bakers.build Platform"
    Then the Board shows the columns "Not assigned, Intake, Working"
    And the Board shows no Conductor filter
    And the Board has no search field
    When I click the work-state chip "Done"
    Then the Board shows the columns "Not assigned, Intake, Working, Done"
    And the address carries "work_state[3]=done"

  Scenario: Blocked and cancelled cards keep textual markers
    Given the ticket index is up to date
    And I am signed in as a member of the "bakers" workspace
    And a dedicated Board project has a blocked ticket and a cancelled ticket
    When I visit the project board for "Board markers"
    Then the Board shows the marker "Blocked"
    When I click the work-state chip "Done"
    Then the Board shows the marker "Cancelled"

  Scenario: The machine account cannot open the Board
    Given I am signed in as "fixture-api-machine"
    When I visit the project board for "bakers.build Platform"
    Then the project board denies access
