@feature:machines-overview
Feature: User Machines listing and View
  Opening the person mark swaps the rail to Account, Conductors and
  Machines. Machines is this account's machines. Opening a row shows
  View at `/user/{user}/machine/{id}`: the Activities of its conductors'
  runs beside one read-only Identity card. The owner's Settings tab edits
  name, max parallel and assignment, and the old edit address leads to the
  View. Navigation
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
    And the tab "Settings" is offered

  Scenario: The owner reads the machine on its View, edits it on Settings, and the old edit address leads to View
    Given I am signed in as a member of the "bakers" workspace
    When I visit the machine "e2e default host"
    Then the "Identity" card offers no Save and no inputs
    And the "Identity" card shows "Max parallel" as "1"
    When I click the tab "Settings"
    Then the Settings offer "Name"
    And the Settings offer "Max parallel"
    And the Settings offer "Assignment"
    When I visit the former edit address of the machine "e2e default host"
    Then the address is the detail of the machine "e2e default host"
    And the page heading is "e2e default host"
    And the "Identity" card offers no Save and no inputs

  Scenario: A machine lists the claims of its conductors' runs
    Given I am signed in as a member of the "bakers" workspace
    When I visit the machine "e2e default host"
    Then the Activities list "BB-142 started work in plan"

  Scenario: The owner sees its conductors and opens Restart runs behind a confirmation
    Given I am signed in as a member of the "bakers" workspace
    When I visit the machine "e2e default host"
    Then the machine Overview lists the conductor "srv01-bakers" with "Restart runs"
    And the machine Overview lists the conductor "srv01-bakers" in the project "bakers.build Platform"
    When I open "Restart runs" on the machine
    Then a dialog asks "e2e default host"
    When I choose "Cancel" in the dialog
    Then the machine Overview lists the conductor "srv01-bakers" with "Restart runs"
    When I open "Restart runs" on the conductor "srv01-bakers"
    Then a dialog asks "srv01-bakers"
    When I press Escape in the Restart runs dialog
    Then the machine Overview lists the conductor "srv01-bakers" with "Restart runs"

  Scenario Outline: Restart runs is the owner's alone
    Given I am logged in as the account "<account>"
    When I request Restart runs on the machine "e2e default host"
    Then the Restart runs address answers 404

    Examples:
      | account           |
      | north-contributor |
      | north-guest       |

  @machine-connection
  Scenario: A lead sees and selects the connection address saved at start
    Given I am signed in as a member of the "bakers" workspace
    When I register a disposable connection machine with "ssh://christian@100.64.0.10:22"
    And I open my disposable connection machine from the listing
    Then the "Identity" card lets me select the link "ssh://christian@100.64.0.10:22" for "Connection URL"
    And my connection machine API exposes "ssh://christian@100.64.0.10:22"
    When my connection machine sends a heartbeat without an address
    Then the "Identity" card lets me select the link "ssh://christian@100.64.0.10:22" for "Connection URL"
    When I register a disposable connection machine with "https://example.com/connect"
    Then the "Identity" card lets me select the link "https://example.com/connect" for "Connection URL"
    When I register a disposable connection machine with "null"
    Then the "Identity" card shows "Connection URL" as "—"
    And my connection machine API exposes "null"
