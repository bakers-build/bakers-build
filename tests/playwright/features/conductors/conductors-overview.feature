@feature:conductors-overview
Feature: User and project conductors listings and Overview
  Opening the person mark swaps the rail to Account, Conductors and
  Machines.
  That listing is the account's conductors. The project Conductors tab opens
  that project's conductors, any owner.
  Opening a row shows the conductor Overview: its Identity card with the
  project, and none of the values its heartbeat writes. There is no Settings
  tab. Navigation runs inside the content island, so a navigating scenario
  clicks twice.

  @shell
  Scenario: The user Conductors listing renders inside the application shell
    Given I am signed in as a member of the "bakers" workspace
    When I visit my user area
    And I click the rail entry "Conductors"
    Then the application shell is present
    And the shell rail is present
    And the rail marks "Conductors" as current
    And the page heading is "Conductors"
    And the user Conductors listing is visible
    And the user Conductors listing shows "srv01-bakers"

  Scenario: Title search narrows the user Conductors listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit my conductors listing
    And I search the user conductors listing for "srv01"
    Then the user Conductors listing shows "srv01-bakers"
    And the user Conductors listing does not show "srv02-bakers-busy"
    When I search the user conductors listing for "no-such-listing-title"
    Then the user Conductors listing is empty
    When I search the user conductors listing for ""
    Then the user Conductors listing shows "srv01-bakers"

  Scenario: A lead opens a conductor Overview from the listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit my conductors listing
    And I click the conductor "srv01-bakers" in the listing
    Then the address is the detail of the conductor "srv01-bakers"
    And the page heading is "srv01-bakers"
    And the conductor Overview shows its project and no heartbeat values
    And there is no tab "Settings"

  Scenario: The project Conductors tab lists that project's conductors
    Given I am signed in as a member of the "bakers" workspace
    When I visit the conductors tab of project "bakers.build Platform"
    Then the page heading is "Conductors"
    And the project Conductors listing is visible
    And the project Conductors listing shows "orphan-node"

  Scenario: The old workspace conductors path is gone
    Given I am signed in as a member of the "bakers" workspace
    When I visit the retired workspace conductors listing
    Then the retired workspace conductors listing is gone

  Scenario: A conductor lists the claims of its own runs
    Given I am signed in as a member of the "bakers" workspace
    When I visit the conductor "srv01-bakers"
    Then the Activities list "BB-142 started work in plan"
