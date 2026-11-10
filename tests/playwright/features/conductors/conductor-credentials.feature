@feature:conductor-credentials
Feature: A conductor's Overview warns about the credentials of its box
  Each heartbeat carries the conductor's own credential checks. The Overview
  lists the checks that are not ok in a Credentials card, one row each with
  the credential, a Warning or Error badge, its expiry and the reason; ok
  checks are not listed. The seeded Northside conductor reports one warning,
  one error and one ok check. The conductors listing marks each conductor
  with its worst status. The card follows the conductor's own access.

  Scenario: A lead sees the credentials that need attention
    Given I am logged in as the account "north-lead"
    When I visit the fixture conductor "conductor.northside"
    Then the "Credentials" card lists 2 table rows
    And the "Credentials" card lists "github" marked "Warning"
    And the "Credentials" card lists "claude" marked "Error"

  Scenario: The conductors listing marks the worst credential status
    Given I am logged in as the account "north-lead"
    When I visit my conductors listing
    Then the user Conductors listing shows "Credentials: Error"

  Scenario: A guest is refused the conductor
    Given I am logged in as the account "north-guest"
    Then the fixture conductor "conductor.northside" answers 403
