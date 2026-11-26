@feature:webhooks
Feature: Admins manage webhooks of a project, a group and the workspace
  A project, a group and the workspace Settings each have a Webhooks tab that
  lists only that scope's webhooks, with a Create webhook action. A row opens
  the webhook's edit form in the dialog; Save and Delete there close it and
  reload the list. There is no detail page. The signing secret is shown
  once, right after the first save, in a copy field like an API key's. Only the
  workspace Admin sees or opens these screens; delivery itself is covered by the
  Kernel tests.

  Scenario Outline: A lead creates, edits, disables and deletes a <scope> webhook
    Given I am logged in as the account "north-lead"
    When I open the Webhooks tab of the <scope> "<owner>"
    Then the page header offers the action "Create webhook"
    When I create the webhook "<name>" for "https://hooks.example.com/<name>"
    Then the signing secret is shown once in a copy field
    When I open the Webhooks tab of the <scope> "<owner>"
    Then the page shows "<name>"
    When I open the webhook "<name>" in the dialog
    Then the signing secret is not shown
    When I cancel the webhook dialog
    Then the webhook dialog is closed
    When I open the webhook "<name>" in the dialog
    And I close the webhook dialog by its close control
    Then the webhook dialog is closed
    When I open the webhook "<name>" in the dialog
    And I save the webhook with the URL "https://hooks.example.com/<name>-moved" and Enabled unticked
    Then the page shows "https://hooks.example.com/<name>-moved"
    And the page shows "Disabled"
    And the signing secret is not shown
    When I open the webhook "<name>" in the dialog
    And I delete the webhook
    And I open the Webhooks tab of the <scope> "<owner>"
    Then the page does not show "<name>"

    Examples:
      | scope     | owner             | name               |
      | project   | Template fixtures | e2e-project-hook   |
      | group     | API home          | e2e-group-hook     |
      | workspace | bakers            | e2e-workspace-hook |

  Scenario: An http address is refused
    Given I am logged in as the account "north-lead"
    When I open the Webhooks tab of the project "Template fixtures"
    And I create the webhook "e2e-http-hook" for "http://hooks.example.com/plain"
    Then the page shows "The URL must start with https://."

  Scenario Outline: <account> cannot open the webhooks of Northside
    Given I am logged in as the account "<account>"
    When I visit the Webhooks tab of the project "Template fixtures" by its address
    Then the page heading is "403 — Access denied"

    Examples:
      | account           |
      | north-contributor |
      | south-lead        |
