@feature:project-overview
Feature: Project Overview shows whether the project is running
  The project canonical address is Overview: the Unhealthy, Intake and In
  progress metrics, Needs attention, Epics and Activities in the main column,
  About and Properties in the inspector. The body is the `full` view mode, not
  a controller.
  Navigation runs inside the content island, so a navigating scenario clicks
  twice. A scenario that counts builds a disposable project world of its own.

  @shell
  Scenario: A lead opens a project Overview from the listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    And I click the project "bakers.build Platform" in the listing
    Then the address is the detail of the project "bakers.build Platform"
    And the page heading is "bakers.build Platform"
    And the tab "Overview" is current
    And the project Overview shows Activities, Properties and Epics
    And the Overview body carries no controller hull

  Scenario: Clicking back to Overview as the second click keeps the island alive
    Given I am signed in as a member of the "bakers" workspace
    And I visit the project "bakers.build Platform"
    When I click the tab "Tickets"
    Then the address ends with "/tickets"
    And the document was not reloaded
    And the tab "Tickets" is current
    When I click the tab "Overview"
    Then the document was not reloaded
    And the tab "Overview" is current
    And the project Overview shows Activities, Properties and Epics

  # The cards share one sticky panel: separate sticky panels slid over each
  # other while scrolling and hid a lower card's Save.
  Scenario: The inspector cards share one panel that fills the inspector column
    Given I am signed in as a member of the "bakers" workspace
    When I visit the project "bakers.build Platform"
    Then the inspector holds exactly one panel
    And inspector panels fill the inspector column

  Scenario: A calm project reads Everything is flowing
    Given a project world with these tickets:
      | ticket       | state   | conductor | runs |
      | Healthy work | working | Oven A    | done |
    And I am signed in as the world's lead
    When I open the world project Overview
    Then the Overview metrics read "Unhealthy 0, Intake 0, In progress 1"
    And Needs attention reads "Everything is flowing"
    And Needs attention reads "No open ticket needs a person right now."

  Scenario: A project without tickets shows one empty state
    Given a project world without tickets
    And I am signed in as the world's lead
    When I open the world project Overview
    Then the Overview shows only the empty state "No tickets yet"

  # Project visibility follows team membership: each persona sits on the team
  # of the world's project, at the rank the scenario names.
  Scenario Outline: Only a lead sees Edit (<persona>)
    Given a project world without tickets
    And the account "<persona>" is seated in the world as a <rank>
    And I am signed in as "<persona>"
    When I open the world project Overview
    Then the Properties card <edit> Edit

    Examples:
      | persona           | rank        | edit           |
      | north-lead        | lead        | offers         |
      | north-contributor | contributor | does not offer |
      | north-guest       | guest       | does not offer |

  Scenario: Projects is current in the sidebar
    Given I am signed in as a member of the "bakers" workspace
    When I visit the project "bakers.build Platform"
    Then the rail marks "Projects" as current
    And the rail disclosure "Projects sub-navigation" is expanded
    When I click the tab "Board"
    Then the tab "Board" is current
    And the rail marks "Projects" as current
    And the rail disclosure "Projects sub-navigation" is expanded

  Scenario: A user outside the bakery is refused the Overview and the Board
    Given I am signed in as "no-bakery"
    When I request the Overview and the Board of the project "bakers.build Platform"
    Then both answer 403 without project data

  Rule: An unhealthy project names its trouble

    Background:
      Given a project world with these tickets:
        | ticket             | state         | conductor | priority | label             | runs   | blocked by       |
        | Not yet assigned   | qualification |           |          |                   |        |                  |
        | Failed run         | working       | Oven A    | 2        |                   | failed |                  |
        | Broken build       | working       | Oven A    | 3        | technical problem |        |                  |
        | Open question      | qualification | Oven A    | 1        | Question          |        |                  |
        | Waiting on blocker | plan          | Oven A    |          | Question          |        | Not yet assigned |
        | Healthy work       | working       | Oven A    |          |                   | done   |                  |
      And I am signed in as the world's lead

    Scenario: The Overview opens with Unhealthy, Intake and In progress
      When I open the world project Overview
      Then the Overview metrics read "Unhealthy 3, Intake 2, In progress 3"

    Scenario: Clicking Unhealthy opens the Board filtered to those tickets
      When I open the world project Overview
      And I click the Overview metric "Unhealthy"
      Then the address carries "health=unhealthy"
      And the Board shows the active filter "Unhealthy · 3"
      And the Board reads "3 of 6 open tickets"
      And the Board shows only the tickets "Failed run, Broken build, Open question"
      When I remove the "Unhealthy" chip
      Then the address does not carry "health="
      And the Board reads "6 of 6 open tickets"

    # Red before yellow, whatever the priority; the blocked ticket waits on
    # other work and is never unhealthy.
    Scenario: Needs attention names each unhealthy ticket's reason
      When I open the world project Overview
      Then Needs attention lists:
        | ticket        | reason            |
        | Failed run    | Last run failed   |
        | Broken build  | Technical problem |
        | Open question | Needs info        |
      And Needs attention does not list "Waiting on blocker"
      And Needs attention reads "Showing 3 of 3 unhealthy tickets"
