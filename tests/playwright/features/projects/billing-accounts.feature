@feature:billing-accounts
Feature: Managing a project's billing accounts
  A project keeps several billing accounts on its Billing tab, exactly one
  of them the Default. New accounts are created in a dialog; Make default
  and Archive are row actions. The default offers no Archive (make another
  account the default first), and an account that tickets link offers no
  Make default. Only project editors reach the tab at all.

  Each scenario works on a project of its own (`a fresh project ... set up
  like ...` deletes and recreates it), so a second run starts from the same
  state as the first and no seeded account is renamed or archived.

  Scenario: A project created in the dialog starts with a default with no External ID
    Given no project is named "Default ledger"
    And I am logged in as "Administrator"
    And I am on the projects screen
    When I open the create-project dialog
    And I fill in "Default ledger" as the project name
    And I pick the group "keytec"
    And I pick the team "Platform Crew"
    And I submit the create-project dialog
    Then the projects list contains "Default ledger"
    And the project "Default ledger" has exactly one active default billing account with external ID ""

  Scenario: An editor creates an account with an External ID, edits and clears it, makes it the default and archives the old one
    Given a fresh project "Ledger editor" set up like "Time capture"
    And I am signed in as a member of the "bakers" workspace
    When I visit the project "Ledger editor"
    And I click the tab "Billing"
    And I click the tab "Overview"
    And I click the tab "Billing"
    Then the tab "Billing" is current
    And the billing account "Ledger editor" is the default without Archive
    When I create the billing account "Ledger retainer" with external ID "00123" in the dialog
    Then the billing account "Ledger retainer" offers Make default and Archive
    And the billing account "Ledger retainer" shows external ID "00123" as text
    When I edit the billing account "Ledger retainer" to external ID "<b>evil</b>"
    Then the billing account "Ledger retainer" shows external ID "<b>evil</b>" as text
    When I edit the billing account "Ledger retainer" to external ID ""
    Then the billing account "Ledger retainer" no longer shows external ID "<b>evil</b>"
    When I make "Ledger retainer" the default billing account
    Then the billing account "Ledger retainer" is the default without Archive
    When I archive the billing account "Ledger editor"
    Then the archived billing account "Ledger editor" is still listed

  Scenario: An editor picks a project type and the dialog shows only its fields
    Given a fresh project "Ledger types" set up like "Time capture"
    And I am signed in as a member of the "bakers" workspace
    When I visit the billing route for the project "Ledger types"
    And I open the new billing account dialog
    Then the billing account dialog offers the types "Time & Materials, Fixed Fee, Non-Billable" with "Time & Materials" chosen
    And the billing account dialog shows the fields "Budget, Hourly rate"
    And the billing account dialog does not show the fields "Fixed fee, Budget resets every month"
    When I pick "Fixed Fee" as "Type" in the billing account dialog
    Then the billing account dialog shows the fields "Fixed fee, Hourly rate"
    When I pick "Amount" as "Budget" in the billing account dialog
    Then the billing account dialog shows the fields "Budget amount"
    And the billing account dialog does not show the fields "Budget resets every month"
    When I pick "Hours" as "Budget" in the billing account dialog
    Then the billing account dialog shows the fields "Budget hours, Budget resets every month"
    When I pick "Non-Billable" as "Type" in the billing account dialog
    Then the billing account dialog does not show the fields "Fixed fee, Budget, Budget hours, Hourly rate"
    When I pick "Fixed Fee" as "Type" in the billing account dialog
    And I fill the billing account field "Name" with "Fixed retainer"
    And I submit the billing account dialog
    Then the billing account dialog marks the field "Fixed fee" as invalid
    When I fill the billing account field "Fixed fee" with "1500"
    And I submit the billing account dialog
    Then the billing account dialog closes with "Billing account created."
    When I open the edit dialog of the billing account "Fixed retainer"
    And I pick "Time & Materials" as "Type" in the billing account dialog
    And I submit the billing account dialog
    Then the billing account dialog closes with "Billing account saved."
    When I open the edit dialog of the billing account "Fixed retainer"
    And I pick "Fixed Fee" as "Type" in the billing account dialog
    Then the billing account field "Fixed fee" is empty

  @nojs
  Scenario: Without JavaScript the same face creates, makes default and archives
    Given a fresh project "Retainer nojs" set up like "Time capture"
    And I am signed in as a member of the "bakers" workspace
    When I visit the billing route for the project "Retainer nojs"
    And I create the billing account "Retainer, no JS" on its own page
    Then the billing account "Retainer, no JS" offers Make default and Archive
    When I make "Retainer, no JS" the default billing account
    Then the billing account "Retainer, no JS" is the default without Archive
    When I archive the billing account "Retainer nojs"
    Then the archived billing account "Retainer nojs" is still listed

  Scenario: A denied contributor gets neither the tab nor the face, even after an editor warmed the page
    Given a fresh project "Guarded ledger" set up like "Time capture"
    And I am signed in as a member of the "bakers" workspace
    When I visit the project "Guarded ledger"
    Then the tab "Billing" is offered
    When I request the billing route for the project "Guarded ledger"
    Then the billing route answers 200
    Given I am logged in as the account "addon-reviewer"
    When I visit the project "Guarded ledger"
    Then there is no tab "Billing"
    When I request the billing route for the project "Guarded ledger"
    Then the billing route answers 403

  Scenario: An anonymous visitor is sent to sign in
    Given a fresh project "Guarded ledger" set up like "Time capture"
    And I am logged in as "Anonymous"
    When I request the billing route for the project "Guarded ledger"
    Then the billing route redirects to sign-in
