@feature:ticket-inline-properties
Feature: Parent and Blocked by are edited inline within the ticket's project
  The detail view's Properties block offers open, visible tickets of the
  ticket's own project as Parent and Blocked by, and a pick is saved like any
  other inline property. "BB-152" lies in "bakers.build Platform"; "GL-E2E-WFI" lies
  in "bakers-e2e-project", which "north-lead" can read too.

  Background:
    Given I am logged in as the account "north-lead"
    And I visit the ticket "BB-152"
    And I remember the inline properties for cleanup

  Scenario: Parent and Blocked by survive reload and offer only the project
    Then the inline "Parent" picker does not offer "waiting_for_input E2E ticket"
    And the inline "Blocked by" picker does not offer "waiting_for_input E2E ticket"
    When I select inline "Parent" option "Designbook coverage for core bakers.build entities"
    Then the inline "Parent" save succeeds without navigation
    When I select inline "Blocked by" option "Ship data-model schema for bb_ticket bundle"
    Then the inline "Blocked by" save succeeds without navigation
    When I reload the page
    Then the inline "Parent" selection is "Designbook coverage for core bakers.build entities"
    And the inline "Blocked by" selection includes "Ship data-model schema for bb_ticket bundle"
