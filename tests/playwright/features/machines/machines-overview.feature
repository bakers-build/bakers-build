@feature:machines-overview
Feature: User Machines listing and View
  Opening the person mark swaps the rail to Account, Conductors and
  Machines. Machines is this account's machines. Opening a row shows
  View at `/user/{user}/machine/{id}`: the Activities of its conductors'
  runs beside one Identity card (name and max parallel editable by the owner;
  host key, owner and current load read-only); there is no Settings tab and
  the old edit address leads to the View. Navigation
  runs inside the content island, so a navigating
  scenario clicks twice.

  @shell
  Scenario: The user Machines listing renders inside the application shell
    Given I am signed in as a member of the "bakers" workspace
    When I visit my user area
    And I click the rail entry "Machines"
    Then the application shell is present
    And the shell rail is present
    And the rail marks "Machines" as current
    And the page heading is "Machines"
    And the user Machines listing is visible
    And the user Machines listing shows "e2e default host"

  Scenario: Title search narrows the user Machines listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit my machines listing
    And I search the user machines listing for "default"
    Then the user Machines listing shows "e2e default host"
    And the user Machines listing does not show "e2e full-capacity host"
    When I search the user machines listing for "no-such-listing-title"
    Then the user Machines listing is empty
    When I search the user machines listing for ""
    Then the user Machines listing shows "e2e default host"

  Scenario: A lead opens a machine View from the listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit my machines listing
    And I click the machine "e2e default host" in the listing
    Then the address is the detail of the machine "e2e default host"
    And the page heading is "e2e default host"
    And the machine Overview shows its host key, max parallel and current load
    And there is no tab "Settings"

  Scenario: The owner edits the machine on its View, and the old edit address leads there
    Given I am signed in as a member of the "bakers" workspace
    When I visit the machine "e2e default host"
    Then there is no tab "Settings"
    And the "Identity" card offers "Name" with Save
    And the "Identity" card offers "Max parallel" with Save
    When I visit the former edit address of the machine "e2e default host"
    Then the address is the detail of the machine "e2e default host"
    And the page heading is "e2e default host"
    And the "Identity" card offers "Name" with Save

  Scenario: A machine lists the claims of its conductors' runs
    Given I am signed in as a member of the "bakers" workspace
    When I visit the machine "e2e default host"
    Then the Activities list "BB-142 started work in plan"
