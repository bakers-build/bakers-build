@feature:ticket-templates
Feature: Projects and workspaces list their ticket templates
  The project screen has a Templates tab, a Views page listing the project's
  templates like the ticket list, with an Add template action in the page header and the
  bakers.build empty state for a project without templates; every row offers its operations,
  including Create ticket for an enabled template, and opens the template's
  detail screen, whose Create ticket opens in the dialog and whose Settings tab
  edits it as a page. A save confirms itself. The workspace Settings tab Templates lists the workspace
  templates and stays open to contributors by its address; only a lead may add one. Create ticket opens the
  ticket create dialog prefilled from the template, and the edited values reach
  the ticket; a workspace template asks for the project. Overrides over the
  endpoint are covered over JSON:API (features/api/ticket-templates.feature).

  Scenario: A lead sees the project's template and the add action
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    Then the tab "Templates" is current
    And the page shows "Fixture template"
    And the page header offers the action "Add template"

  Scenario: Create ticket lands on the generated ticket
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    And I create a ticket from the template "Web fixture template" in the dialog with the title "Edited web fixture ticket"
    Then the page shows "Edited web fixture ticket"

  Scenario: An enabled template offers Create ticket
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    Then the page says "Create ticket"

  Scenario: A project without templates says so
    Given I am logged in as the account "north-lead"
    When I visit the project "bakers.build Platform"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    Then the listing shows the empty state "This project has no ticket templates yet."
    And the page header describes the screen as "Reusable ticket recipes for this project."

  Scenario: A lead adds a template from the tab
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I open the Add template action twice
    Then the add template form explains the placeholders of both patterns
    And the add template form offers no "Project" picker
    And the add template form offers the conductor "No conductor" but not "srv01-bakers"
    When I save the template "Added template JS" with the title pattern "Added {{month}}", the workflow "bakers.build bug" and the target state "Diagnose"
    Then the tab "Templates" is current
    And the template "Added template JS" is listed with the workflow "bakers.build bug"

  @nojs
  Scenario: A lead adds a template without JavaScript
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I open the Add template action twice
    Then the add template form explains the placeholders of both patterns
    When I save the template "Added template no-JS" with the title pattern "Added {{month}}", the workflow "bakers.build chore" and the target state "Spec"
    Then the tab "Templates" is current
    And the template "Added template no-JS" is listed with the workflow "bakers.build chore"

  Scenario: A lead opens a template from the tab
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    And I open the template "Web fixture template"
    Then the template shows "Workflow" as "bakers.build chore"
    And the template shows "Target state" as "Qualification"
    And the template shows "Labels" as "work:code"
    And the template shows "Title" as "Web fixture ticket {{date}}"
    And the page shows "Generated from the fixture template."
    And the template offers the action "Create ticket"

  Scenario: A member of another workspace cannot open a template
    Given I am logged in as the account "south-contributor"
    When I visit the template "Web fixture template" by its address
    Then the page heading is "403 — Access denied"
    And the page does not show "Web fixture ticket"

  Scenario: Saving a template's settings from the list confirms the save
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I click the tab "Overview"
    And I click the tab "Templates"
    And I open the settings of the template "Web fixture template" from the list and save it
    Then the tab "Templates" is current
    And the page confirms the template "Web fixture template" was saved

  Scenario: Saving a template on its Settings tab confirms the save
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I open the template "Web fixture template"
    And I click the tab "Settings"
    And I click the tab "Overview"
    And I click the tab "Settings"
    And I save the template settings
    Then the tab "Settings" is current
    And the page confirms the template "Web fixture template" was saved

  Scenario: Create ticket on the detail screen confirms in the dialog
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I open the template "Web fixture template"
    And I create a ticket from the template in the dialog
    Then the page shows "Web fixture ticket"

  Scenario: A lead manages workspace templates
    Given I am logged in as the account "north-lead"
    When I visit My work
    And I click the rail entry "Settings"
    And I click the tab "Templates"
    And I click the tab "Settings"
    And I click the tab "Templates"
    Then the tab "Templates" is current
    And the page shows "Workspace fixture template"
    And the page header offers the action "Add template"
    When I open the Add template action twice
    Then the add template form offers the project "Template fixtures"
    And the add template form offers the conductor "No conductor" but not "srv01-bakers"
    When I save the template "Added template workspace" with the title pattern "Added {{month}}", the workflow "bakers.build bug" and the target state "Diagnose"
    Then the tab "Templates" is current
    And the template "Added template workspace" is listed with the workflow "bakers.build bug"

  Scenario: A contributor uses a workspace template in a chosen project
    Given I am logged in as the account "fixture-time-contributor"
    When I visit the workspace templates of "bakers"
    Then the page shows "Workspace fixture template"
    And the page header does not offer the action "Add template"
    When I create a ticket from the template "Workspace fixture template" in the project "Time capture" with the title "Contributor workspace ticket"
    Then the page shows "Contributor workspace ticket"
    And the page shows "Time capture"
