@feature:ticket-inline-properties
Feature: Ticket reviewers persist as searchable chips
  Reviewers sit after Assignee on the Properties block. Each pick saves itself.
  Each selected account is a removable chip; removing one saves and keeps the
  others.

  # Own fixture ticket (BB-150), separate from ticket-inline-properties.feature's
  # BB-142: four workers run both files at once, and sharing a fixture let their
  # writes race this feature's remember/restore assertions.

  Background:
    Given I am logged in as "Administrator"
    And I visit the ticket "BB-150"
    And I remember the inline properties for cleanup
    And the Properties block exposes the people pickers

  Scenario: Two reviewers survive save and reload
    When I select inline "Reviewers" option "north-member"
    And I select inline "Reviewers" option "north-lead"
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection includes "north-member"
    And the inline "Reviewers" selection includes "north-lead"
    And the inline "Reviewers" chips are "north-member, north-lead"

  Scenario: Removing one chip keeps the other
    When I select inline "Reviewers" option "north-member"
    And I select inline "Reviewers" option "north-lead"
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    And I remove the inline "Reviewers" chip "north-member"
    Then the inline "Reviewers" chips are "north-lead"
    When I reload the page
    Then the inline "Reviewers" selection includes "north-lead"
    And the inline "Reviewers" chips are "north-lead"

  Scenario: Clearing all reviewers survives reload
    When I select inline "Reviewers" option "north-member"
    Then the inline "Reviewers" save succeeds without navigation
    When I select inline "Reviewers" option "No reviewers"
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection is empty
    And the inline "Reviewers" chips are ""

  Scenario: Saving another property preserves earlier reviewer changes
    When I select inline "Reviewers" option "north-member"
    Then the inline "Reviewers" save succeeds without navigation
    When I select inline "Priority" option "High"
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" selection includes "north-member"
    And the inline "Priority" selection is "High"

  Scenario: Chips keep working after a save replaced the form
    When I select inline "Reviewers" option "north-member"
    Then the inline "Reviewers" save succeeds without navigation
    When I remove the inline "Reviewers" chip "north-member"
    Then the inline "Reviewers" chips are ""
    When I select inline "Reviewers" option "north-lead"
    Then the inline "Reviewers" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" chips are "north-lead"

  Scenario: Another editor's reviewer change survives my unrelated save
    When another editor sets the reviewers of "BB-150" to "north-member"
    And I select inline "Priority" option "High"
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Reviewers" chips are "north-member"
    And the inline "Priority" selection is "High"
