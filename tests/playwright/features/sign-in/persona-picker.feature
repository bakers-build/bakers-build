@feature:persona-picker
Feature: One-click sign-in as a test persona
  The e2e world's sign-in page carries a Test personas section: one button per
  active @example.test account, personas first, then fixture accounts. A click
  signs in as that account and lands where every completed sign-in lands. Real
  addresses and service accounts are never offered.

  Scenario: The picker lists personas and fixture accounts, never another account
    When I open anonymous login
    Then the test persona picker lists "north-lead" under "Personas"
    And the test persona picker lists "no-bakery" under "Personas"
    And the test persona picker lists "fixture-agent" under "Fixture accounts"
    And the test persona picker does not list "Administrator"
    And the test persona picker does not list "fixture-automation"

  Scenario: One click signs in and lands like a normal sign-in
    When I open anonymous login
    And I sign in as the test persona "north-lead"
    Then I am logged in
    And the address is "/home"

  Scenario: A persona of both bakeries lands on the workspace chooser
    When I open anonymous login
    And I sign in as the test persona "both-bakeries"
    Then I am logged in
    And the workspace chooser is present
    And the workspace chooser offers "/bakers/tickets"
    And the workspace chooser offers "/other/tickets"
