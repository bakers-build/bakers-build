@feature:catalog-environments
Feature: Catalog manages the workspace's environments
  The Environments tab lists the environments of every project of the
  workspace, each with its project, and filters by project. A lead adds an
  environment for a project of the workspace from the tab, and edits or
  deletes it from its Edit tab. A contributor reads the list and gets no action;
  a guest has no tab. Other workspaces' accounts and outsiders are refused.

  Scenario: A lead adds, filters, edits and deletes environments
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/catalog/environments"
    Then the tab "Environments" is current
    When I add the environment "Catalog env platform" for the project "bakers.build Platform"
    Then the tab "Environments" is current
    And the environment "Catalog env platform" is listed with the project "bakers.build Platform"
    When I add the environment "Catalog env templates" for the project "Template fixtures"
    And I filter the environments by the project "Template fixtures"
    Then the environment "Catalog env templates" is listed with the project "Template fixtures"
    And the environment "Catalog env platform" is not listed
    When I open the environment "Catalog env templates"
    And I rename the environment on its page to "Catalog env renamed"
    And I visit "/bakers/catalog/environments"
    Then the environment "Catalog env renamed" is listed with the project "Template fixtures"
    When I open the environment "Catalog env renamed"
    And I delete the environment from its Edit tab
    Then the tab "Environments" is current
    And the environment "Catalog env renamed" is not listed

  Scenario: A contributor reads environments but cannot change them
    Given the project "API home" has the environment "Catalog env read only"
    And I am logged in as the account "north-contributor"
    When I visit "/bakers/catalog/environments"
    Then the environment "Catalog env read only" is listed with the project "API home"
    And the page header does not offer the action "Add environment"
    And the edit page of the environment "Catalog env read only" answers 403
    And the delete page of the environment "Catalog env read only" answers 403
    When I visit "/bakers/catalog/environments/add"
    Then the page is not found or forbidden

  Scenario: A guest has no Environments tab
    Given I am logged in as the account "north-guest"
    When I visit "/bakers/catalog/environments"
    Then the page is not found or forbidden

  Scenario Outline: <account> is refused on the bakers Catalog <tab> tab
    Given I am logged in as the account "<account>"
    When I visit "/bakers/catalog/<tab>"
    Then the page is not found or forbidden

    Examples:
      | account    | tab          |
      | south-lead | types        |
      | south-lead | environments |
      | no-bakery  | types        |
      | no-bakery  | environments |
