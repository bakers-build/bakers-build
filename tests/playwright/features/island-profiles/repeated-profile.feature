@feature:repeated-island-profile
Feature: App events stay inside the profile instance that emitted them
  Repeated plugins retain distinct settings. Both rendered instances use the
  same persisted profile; only its subscribed Alpha peer should be refreshed.

  Scenario Outline: Two consecutive events refresh exactly the eligible placements
    Given I am logged in as "Administrator"
    And I open the repeated profile fixture
    Then both profile instances have distinct runtime identities and settings
    When I refresh counters in profile instance "<instance>"
    Then exactly its trigger and Alpha placements were refreshed in one request
    And the document was not reloaded
    When I refresh counters in profile instance "<instance>"
    Then exactly its trigger and Alpha placements were refreshed in one request
    And the document was not reloaded

    Examples:
      | instance |
      | first    |
      | second   |
