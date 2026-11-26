@feature:project-environments
Feature: A project manages its environments
  Environments belong to their project: its Environments tab lists them, a lead
  adds one there, and a row opens its edit form in the dialog, which shows only
  editable fields and offers Delete. An environment has no page of its own. A
  contributor reads the list and gets no action; a guest has no tab. Other
  workspaces' accounts and outsiders are refused.

  Scenario: A lead adds, edits and deletes an environment on its project
    Given I am logged in as the account "north-lead"
    When I visit the project "bakers.build Platform"
    And I click the tab "Environments"
    Then the tab "Environments" is current
    When I add the environment "Project env platform"
    Then the tab "Environments" is current
    And the environment "Project env platform" is listed
    When I open the environment "Project env platform"
    Then the environment dialog offers no "Created", "Changed" or "Owner" field
    When I rename the environment in its dialog to "Project env renamed"
    Then the environment "Project env renamed" is listed
    And the environment "Project env platform" is not listed
    When I open the environment "Project env renamed"
    And I delete the environment from its dialog
    Then the tab "Environments" is current
    And the environment "Project env renamed" is not listed

  Scenario: A lead adding an environment under a taken name keeps the form with its error
    Given the project "bakers.build Platform" has the environment "Project env taken"
    And I am logged in as the account "north-lead"
    When I visit the Environments tab of the project "bakers.build Platform"
    And I save the new environment "Project env taken"
    Then the environment form stays open with the error "An environment named Project env taken already exists in this project."

  Scenario: A contributor reads environments but cannot change them
    Given the project "API home" has the environment "Project env read only"
    And I am logged in as the account "north-contributor"
    When I visit the Environments tab of the project "API home"
    Then the environment "Project env read only" is listed
    And the page header does not offer the action "Add environment"
    And the edit page of the environment "Project env read only" answers 403
    And the delete page of the environment "Project env read only" answers 403
    And the page of the environment "Project env read only" answers 404

  Scenario: A guest has no Environments tab
    Given I am logged in as the account "north-guest"
    When I visit the Environments tab of the project "API home"
    Then the page is not found or forbidden

  Scenario Outline: <account> is refused on a bakers project's Environments tab
    Given I am logged in as the account "<account>"
    When I visit the Environments tab of the project "API home"
    Then the page is not found or forbidden

    Examples:
      | account    |
      | south-lead |
      | no-bakery  |
