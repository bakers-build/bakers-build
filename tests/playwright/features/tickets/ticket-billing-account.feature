@feature:ticket-billing-account
Feature: A ticket's billing account in the inspector
  The ticket inspector names the billing account recorded time on the ticket
  is booked to, and its Source: linked on this ticket, from the nearest
  ancestor that links one, or the project default. A project editor picks a
  linkable account (never the default) or Inherit; everyone else reads the
  row, and a direct request to change it is denied.

  Each scenario recreates its own project with an epic, a child and one
  extra account, so a second run starts from the same state as the first and
  the JS and no-JS projects never share a fixture.

  Scenario: An editor links the epic, the child inherits, Record time follows, Inherit undoes it
    Given a fresh project "Billing link" set up like "Time capture"
    And the project "Billing link" has the billing account "Kunde X"
    And the project "Billing link" has the epic "Billed epic" with the child "Billed child"
    And I am signed in as a member of the "bakers" workspace
    When I open the ticket titled "Billed epic"
    And I open the ticket titled "Billed epic"
    Then the ticket billing reads "Billing link" from "project default"
    When I link the ticket to the billing account "Kunde X"
    Then the ticket billing reads "Kunde X" from "linked"
    When I open the ticket titled "Billed child"
    Then the ticket billing reads "Kunde X" from the ticket titled "Billed epic"
    When I open Record time for the ticket titled "Billed child"
    Then Record time preselects the billing account "Kunde X"
    When I open the ticket titled "Billed epic"
    And I let the ticket inherit its billing account
    Then the ticket billing reads "Billing link" from "project default"
    And the billing account "Kunde X" is active and links no ticket

  @nojs
  Scenario: Without JavaScript an editor links and unlinks through the native choice
    Given a fresh project "Billing nojs" set up like "Time capture"
    And the project "Billing nojs" has the billing account "Kunde X"
    And the project "Billing nojs" has the epic "Billed epic" with the child "Billed child"
    And I am signed in as a member of the "bakers" workspace
    When I open the ticket titled "Billed epic"
    And I choose the billing account "Kunde X" without JavaScript
    Then the ticket billing reads "Kunde X" from "linked"
    When I choose the billing account "Inherit" without JavaScript
    Then the ticket billing reads "Billing nojs" from "project default"

  Scenario: A viewer reads the row without a picker and cannot post a link
    Given a fresh project "Billing viewer" set up like "Time capture"
    And the project "Billing viewer" has the billing account "Kunde X"
    And the project "Billing viewer" has the epic "Billed epic" with the child "Billed child"
    And the ticket titled "Billed epic" is linked to the billing account "Kunde X"
    And I am logged in as the account "addon-reviewer"
    When I open the ticket titled "Billed epic"
    Then the ticket billing reads "Kunde X" from "linked"
    And the ticket billing offers no picker
    When I request the billing link route of the ticket titled "Billed epic"
    Then the billing link route answers 403

  Scenario: An anonymous visitor cannot reach the link route
    Given a fresh project "Billing anonymous" set up like "Time capture"
    And the project "Billing anonymous" has the billing account "Kunde X"
    And the project "Billing anonymous" has the epic "Billed epic" with the child "Billed child"
    And I am logged in as "Anonymous"
    When I request the billing link route of the ticket titled "Billed epic"
    Then the billing link route redirects to sign-in
