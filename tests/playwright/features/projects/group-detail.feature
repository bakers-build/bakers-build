@feature:group-detail
Feature: A group is reachable from the Groups listing and has a Settings tab
  The Groups listing links every row to the group's detail. The detail edits
  nothing: its first card, Properties, shows the group's name, owner and
  workspace read-only, and a lead edits the group under its Settings tab.
  Navigation runs inside the content island, so the scenario clicks more than
  once: a declaration lost in a swap survives the first click.

  Scenario: A lead opens a group from the listing and reaches its settings
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Groups" listing
    And I click the group "Alpha Billing" in the listing
    Then the address is the detail of the group "Alpha Billing"
    And the page heading is "Alpha Billing"
    And the first card is "Properties"
    And the "Properties" card shows "Name" as "Alpha Billing"
    And the group detail shows its owner and workspace
    And the "Properties" card offers no Save and no inputs
    And the "Identity" card offers no Save and no inputs
    When I click the tab "Settings"
    Then the address ends with "/settings"
    And the document was not reloaded
    And the settings form edits only the name "Alpha Billing"
    And the page heading is not the workspace label
    When I click the tab "Overview"
    Then the document was not reloaded
    And the group detail shows its owner and workspace

  Scenario: A view-only member sees the detail but not the settings
    Given I am logged in as the account "api-member"
    When I visit the group "API home"
    Then the group detail shows its owner and workspace
    And there is no tab "Settings"
    And the "Properties" card offers no Save and no inputs
    And the settings of the group "API home" are refused
