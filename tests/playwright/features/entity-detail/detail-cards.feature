@feature:detail-cards
Feature: Entity detail pages save each card on its own
  Team, group, machine, conductor and project details share one layout: an
  Activities feed beside one inspector card per section. An editable card is
  its own form with its own Save. Team, machine and conductor each have one
  editable card; a Save replaces only that card, a refresh of another
  placement keeps its unsent input, and a rename updates the page heading
  and the document title without a reload. The project and group details
  edit nothing: their Settings do. Readers see read-only rows, and a card
  POST without update access is refused. The former Settings addresses of
  team and machine lead to the detail page. Conductor and machine Activities list only the activities of
  their own runs. Every editing scenario edits a disposable world of its own,
  removed afterwards; the access scenarios only read seeded fixtures.

  Scenario Outline: An editor renames a <entity> on its Identity card and saves again
    Given I edit a disposable detail world
    When I open the <entity> detail page
    And I set "<label>" to "Renamed <entity>" in the "Identity" card
    And I save the "Identity" card
    Then the "Identity" card says "saved."
    And the page heading is "Renamed <entity>"
    And the document title names "Renamed <entity>"
    And the document title names the site once
    And the document was not reloaded
    And the stored <entity> <field> is "Renamed <entity>"
    When I set "<label>" to "Renamed <entity> twice" in the "Identity" card
    And I save the "Identity" card
    Then the page heading is "Renamed <entity> twice"
    And the document title names "Renamed <entity> twice"
    And the stored <entity> <field> is "Renamed <entity> twice"
    When I reload the page
    Then the "Identity" card field "<label>" holds "Renamed <entity> twice"
    And the page heading is "Renamed <entity> twice"

    Examples:
      | entity    | label | field |
      | machine   | Name  | name  |
      | team      | Name  | name  |
      | conductor | Label | label |

  Scenario: A machine saves its name and capacity together on its one card
    Given I edit a disposable detail world
    When I open the machine detail page
    Then the detail page has no "Capacity" card
    And the "Identity" card offers "Max parallel" with Save
    And the "Identity" card shows "Host key" as "detail-"
    And the "Identity" card shows "Current load" as "0"
    When I set "Name" to "Machine on one card" in the "Identity" card
    And I set "Max parallel" to "7" in the "Identity" card
    And I save the "Identity" card
    Then the "Identity" card says "saved."
    And the stored machine name is "Machine on one card"
    And the stored machine max_parallel is "7"
    And the page heading is "Machine on one card"

  Scenario: The project detail offers its editor no input and no card POST
    Given I edit a disposable detail world
    When I open the project detail page
    Then the "Properties" card offers no Save and no inputs
    And the "Properties" card shows "Key" as "D"
    And the "Identity" card offers no Save and no inputs
    And the "Identity" card shows "Description" as "Seeded project text"
    When I post the "properties" card of the world project directly
    Then the card post is refused with status 404
    And the stored project name is still its original value

  Scenario: Unsent input in a card survives a refresh of the Activities and of the page header
    Given I edit a disposable detail world
    When I open the machine detail page
    And I set "Max parallel" to "9" in the "Identity" card
    And I refresh the Activities
    Then the "Identity" card field "Max parallel" holds "9"
    Given another editor stores the machine name "Stored elsewhere"
    When the page is announced the island event "bakers.entity.renamed"
    Then the page heading is "Stored elsewhere"
    And the "Identity" card field "Max parallel" holds "9"
    And the document was not reloaded
    And the stored machine max_parallel is still its original value

  Scenario: A card's own Refresh shows external changes and asks before dropping input
    Given I edit a disposable detail world
    When I open the conductor detail page
    And another editor stores the conductor label "Stored elsewhere"
    And I refresh the "Identity" card
    Then the "Identity" card field "Label" holds "Stored elsewhere"
    And the document was not reloaded
    When I set "Label" to "Unsent label" in the "Identity" card
    And I refresh the "Identity" card and keep my changes
    Then the "Identity" card field "Label" holds "Unsent label"
    When I refresh the "Identity" card and discard my changes
    Then the "Identity" card field "Label" holds "Stored elsewhere"

  Scenario Outline: An empty <entity> <field> is reported in its card, kept, and corrected
    Given I edit a disposable detail world
    When I open the <entity> detail page
    And I set "<label>" to "" in the "Identity" card past browser validation
    And I save the "Identity" card
    Then the "Identity" card says "<label> field is required."
    And the "Identity" card field "<label>" holds ""
    And the stored <entity> <field> is still its original value
    When I refresh the "Identity" card and keep my changes
    Then the "Identity" card field "<label>" holds ""
    When I set "<label>" to "Corrected <entity>" in the "Identity" card
    And I save the "Identity" card
    Then the stored <entity> <field> is "Corrected <entity>"
    And the page heading is "Corrected <entity>"

    Examples:
      | entity  | label | field |
      | machine | Name  | name  |
      | team    | Name  | name  |

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
      | fixture              | card          | operation     | row          | value                    | status |
      | group.edit           | Properties    | properties    | Workspace    | Northside Bakery         | 404    |
      | group.edit           | Identity      | identity      | Description  | —                        | 404    |
      | project.edit         | Properties    | properties    | Key          | EDP1                     | 404    |
      | team.home            | Identity      | identity      | Workspace    | Northside Bakery         | 403    |
      | conductor.properties | Identity      | identity      | Conductor ID | bdd-properties-conductor | 403    |

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
      | fixture-lead            | team.home    |
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

  # Without JavaScript a Save is a native POST of that one card; unsent input
  # in other cards is not promised to survive the page change.
  @nojs
  Scenario: Without JavaScript a card Save posts only that card and shows the result
    Given I edit a disposable detail world
    When I open the machine detail page
    And I set "Name" to "Renamed without JavaScript" in the "Identity" card
    And I save the "Identity" card
    Then the page shows "saved."
    And the page heading is "Renamed without JavaScript"
    And the document title names "Renamed without JavaScript"
    And the document title names the site once
    And the stored machine name is "Renamed without JavaScript"
