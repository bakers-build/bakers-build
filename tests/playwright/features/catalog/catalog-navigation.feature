@feature:catalog-navigation
Feature: Catalog is a workspace settings tab for the categories tickets pick from
  Catalog sits in the workspace settings after Templates and opens on Types,
  with Types, Recipes and Labels as its subsection tabs. The rail has no
  Catalog entry; Settings is current on the Catalog pages. Only a lead has the
  Settings entry; other ranks reach the Catalog by its address. Environments
  belong to their project, not to the Catalog.

  Scenario: A lead opens Catalog from workspace settings
    Given I am logged in as the account "north-lead"
    When I visit My work
    Then the rail lists "Insights, Settings" in this order
    And the rail does not list "Catalog"
    When I click the rail entry "Settings"
    Then the page offers the "Catalog" tab
    When I click the tab "Catalog"
    Then the tab "Types" is current
    And the subsection tabs are "Types, Recipes, Labels"
    When I click the tab "Labels"
    Then the tab "Labels" is current
    And the rail marks "Settings" as current

  Scenario: A guest opens Catalog by its address
    Given I am logged in as the account "north-guest"
    When I visit "/bakers/settings/catalog/types"
    Then the tab "Types" is current
    And the subsection tabs are "Types, Recipes, Labels"
