@feature:catalog-navigation
Feature: Catalog is one rail entry for the categories tickets pick from
  Catalog sits between Insights and Settings and opens on Types, with Types,
  Recipes, Labels and Environments as its tabs. Workspace settings keep only
  real settings. A guest reads the term tabs but has no Environments tab.

  Scenario: A lead opens Catalog from the rail
    Given I am logged in as the account "north-lead"
    When I visit My work
    Then the rail lists "Insights, Catalog, Settings" in this order
    When I click the rail entry "Catalog"
    Then the tab "Types" is current
    And the tabs are "Types, Recipes, Labels, Environments"
    When I click the tab "Environments"
    Then the tab "Environments" is current
    And the rail marks "Catalog" as current

  Scenario: Workspace settings no longer hold the term tabs
    Given I am logged in as the account "north-lead"
    When I visit My work
    And I click the rail entry "Settings"
    Then the page offers the "Templates" tab
    And the page does not offer the "Types" tab
    And the page does not offer the "Recipes" tab
    And the page does not offer the "Labels" tab
    And the page does not offer the "Environments" tab

  Scenario: A guest opens Catalog on its term tabs
    Given I am logged in as the account "north-guest"
    When I visit My work
    And I click the rail entry "Catalog"
    Then the tab "Types" is current
    And the tabs are "Types, Recipes, Labels"
