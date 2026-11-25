@feature:detail-cards
Feature: Entity detail pages show read-only cards; Settings edit
  Team, group, machine, conductor and project details share one layout: an
  Activities feed beside one inspector card per section. The cards edit
  nothing: each entity's Settings do, and a card has no POST address. The
  project inspector has About and Properties. The former edit address of a
  machine leads to its detail page. Conductor and machine Activities list only the activities of
  their own runs. Every editing scenario edits a disposable world of its own,
  removed afterwards; the access scenarios only read seeded fixtures.

  Scenario Outline: An editor renames a <entity> on its Settings and its card shows the new name
    Given I edit a disposable detail world
    When I open the <entity> detail page
    Then the "Identity" card offers no Save and no inputs
    When I click the tab "Settings"
    And I set "<label>" to "Renamed <entity>" on the Settings
    And I save the Settings
    Then the stored <entity> <field> is "Renamed <entity>"
    When I open the <entity> detail page
    Then the page heading is "Renamed <entity>"
    And the document title names "Renamed <entity>"
    And the "Identity" card shows "<label>" as "Renamed <entity>"

    Examples:
      | entity    | label | field |
      | machine   | Name  | name  |
      | conductor | Label | label |

  Scenario: A machine saves its name and capacity together on its Settings
    Given I edit a disposable detail world
    When I open the machine detail page
    Then the detail page has no "Capacity" card
    And the "Identity" card shows "Host key" as "detail-"
    And the "Identity" card shows "Current load" as "0"
    When I click the tab "Settings"
    And I set "Name" to "Machine on Settings" on the Settings
    And I set "Max parallel" to "7" on the Settings
    And I save the Settings
    Then the stored machine name is "Machine on Settings"
    And the stored machine max_parallel is "7"
    And the page heading is "Machine on Settings"

  Scenario: The project detail offers its editor no input and no card POST
    Given I edit a disposable detail world
    When I open the project detail page
    Then the "Properties" card offers no Save and no inputs
    And the "Properties" card shows "Identifier prefix" as "D"
    And the "About" card offers no Save and no inputs
    And the "About" card says "Seeded project text"
    When I post the "properties" card of the world project directly
    Then the card post is refused with status 404
    And the stored project name is still its original value

  Scenario: The team detail offers its editor no input: its Settings edit it
    Given I edit a disposable detail world
    When I open the team detail page
    Then the "Identity" card offers no Save and no inputs

  Scenario Outline: A reader sees the <card> card of <fixture> read-only and its POST is refused
    Given I am logged in as the account "north-contributor"
    When I open the detail page of fixture "<fixture>"
    Then the "<card>" card offers no Save and no inputs
    And the "<card>" card shows "<row>" as "<value>"
    When I post the "<operation>" card of fixture "<fixture>" directly
    Then the card post is refused with status <status>
    And the fixture "<fixture>" is not named "Reader must not write"

    # A card without editable fields has no POST address at all.
    Examples:
      | fixture              | card          | operation     | row               | value                    | status |
      | group.edit           | Properties    | properties    | Workspace         | Northside Bakery         | 404    |
      | group.edit           | Identity      | identity      | Description       | —                        | 404    |
      | project.edit         | Properties    | properties    | Identifier prefix | EDP1                     | 404    |
      | team.home            | Identity      | identity      | Workspace         | Northside Bakery         | 404    |
      | conductor.properties | Identity      | identity      | Conductor ID      | bdd-properties-conductor | 404    |

  Scenario Outline: A reader of another workspace gets no detail page of <fixture>
    Given I am logged in as the account "south-contributor"
    When I request the detail page of fixture "<fixture>"
    Then the detail page is refused and shows no cards

    Examples:
      | fixture              |
      | group.edit           |
      | project.edit         |
      | team.home            |
      | conductor.properties |
      | machine.edit         |

  Scenario Outline: The former settings address of <fixture> leads to its detail page
    Given I am logged in as the account "<account>"
    When I request the former settings address of fixture "<fixture>"
    Then I land on the detail page of fixture "<fixture>" with its "Identity" card
    And a POST to the former settings address of fixture "<fixture>" answers 405
    And the fixture "<fixture>" is not named "Retired form must not write"

    Examples:
      | account             | fixture      |
      | fixture-conductor-owner | machine.edit |

  Scenario: A run's activities are listed on the conductor and machine of that run only
    Given I edit a disposable detail world
    And the world has a second machine with its own conductor
    And a ticket of the world project moved on without a run
    And the ticket was claimed at "plan" by a run of the first conductor
    When I open the second machine detail page
    Then the Activities say "No activity yet."
    Given a run of the second conductor failed at "plan"
    And the ticket is assigned to the second conductor
    When I refresh the Activities
    Then the Activities list the ticket "run failed in plan"
    And the document was not reloaded
    And the Activities do not list the ticket "started work in plan"
    And the Activities do not list the ticket "qualification → plan"
    When I open the second conductor detail page
    Then the Activities list the ticket "run failed in plan"
    And the Activities do not list the ticket "started work in plan"
    And the Activities do not list the ticket "qualification → plan"
    When I open the machine detail page
    Then the Activities list the ticket "started work in plan"
    And the Activities do not list the ticket "run failed in plan"
    And the Activities do not list the ticket "qualification → plan"
    When I open the conductor detail page
    Then the Activities list the ticket "started work in plan"
    And the Activities do not list the ticket "run failed in plan"
    And the Activities do not list the ticket "qualification → plan"
    When I open the project detail page
    Then the Activities list the ticket "started work in plan"
    And the Activities list the ticket "run failed in plan"
    And the Activities list the ticket "qualification → plan"
