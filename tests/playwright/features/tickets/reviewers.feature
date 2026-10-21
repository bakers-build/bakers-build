@feature:ticket-inline-properties
Feature: Ticket reviewers persist as searchable chips
  Reviewers sit after Assignee on the Properties block. A pick changes nothing
  until Save. Each selected account is a removable chip; removing one keeps the
  others. Leaving without Save discards the attempt.

  # Own fixture ticket (BB-150), separate from ticket-inline-properties.feature's
  # BB-142: four workers run both files at once, and sharing a fixture let their
  # writes race this feature's remember/restore assertions.

  Background:
    Given I am logged in as "Administrator"
    And I visit the ticket "BB-150"
    And I remember the inline properties for cleanup
    And the Properties block exposes the people pickers

  Scenario: Two reviewers survive save and reload
    When I select inline "Reviewers" option "sgruber"
    And I select inline "Reviewers" option "cwiedemann"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection includes "sgruber"
    And the inline "Reviewers" selection includes "cwiedemann"
    And the inline "Reviewers" chips are "sgruber, cwiedemann"

  Scenario: Removing one chip keeps the other until Save
    When I select inline "Reviewers" option "sgruber"
    And I select inline "Reviewers" option "cwiedemann"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    And I remove the inline "Reviewers" chip "sgruber"
    Then the inline "Reviewers" chips are "cwiedemann"
    And I save the inline properties
    When I reload the page
    Then the inline "Reviewers" selection includes "cwiedemann"
    And the inline "Reviewers" chips are "cwiedemann"

  Scenario: Clearing all reviewers survives reload
    When I select inline "Reviewers" option "sgruber"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I select inline "Reviewers" option "No reviewers"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection is empty
    And the inline "Reviewers" chips are ""

  Scenario: Leaving without Save discards a reviewers pick
    Then picking inline "Reviewers" option "sgruber" writes nothing until Save

  Scenario: Saving another property preserves earlier reviewer changes
    When I select inline "Reviewers" option "sgruber"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I select inline "Priority" option "High"
    And I save the inline properties
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection includes "sgruber"
    And the inline "Priority" selection is "High"

  Scenario: Chips keep working after Save replaced the form
    When I select inline "Reviewers" option "sgruber"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I remove the inline "Reviewers" chip "sgruber"
    Then the inline "Reviewers" chips are ""
    When I select inline "Reviewers" option "cwiedemann"
    And I save the inline properties
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" chips are "cwiedemann"

  Scenario: Another editor's reviewer change survives my unrelated save
    When another editor sets the reviewers of "BB-150" to "sgruber"
    And I select inline "Priority" option "High"
    And I save the inline properties
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" chips are "sgruber"
    And the inline "Priority" selection is "High"
