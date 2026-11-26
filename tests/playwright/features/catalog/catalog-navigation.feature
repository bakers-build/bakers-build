@feature:catalog-navigation
Feature: Catalog is a workspace settings tab for the categories tickets pick from
  Catalog sits in the workspace settings after Templates and opens on Types,
  with Types, Recipes, Labels and Environments as its subsection tabs. The rail
  has no Catalog entry; Settings is current on the Catalog pages. Only a lead
  has the Settings entry; other ranks reach the Catalog by its address, and a
  guest reads the term tabs but has no Environments tab.

  Scenario: A lead opens Catalog from workspace settings
    Given I am logged in as the account "north-lead"
    When I visit My work
    Then the rail lists "Insights, Settings" in this order
    And the rail does not list "Catalog"
    When I click the rail entry "Settings"
    Then the page offers the "Catalog" tab
    When I click the tab "Catalog"
    Then the tab "Types" is current
    And the subsection tabs are "Types, Recipes, Labels, Environments"
    When I click the tab "Environments"
    Then the tab "Environments" is current
    And the rail marks "Settings" as current

  Scenario: A guest opens Catalog by its address on its term tabs
    Given I am logged in as the account "north-guest"
    When I visit "/bakers/settings/catalog/types"
    Then the tab "Types" is current
    And the subsection tabs are "Types, Recipes, Labels"
