@functional @api
Feature: Rank-scoped JSON API reads
  Workspace membership opens the tenancy boundary; project membership or a
  workspace-wide rank determines which tickets a client can read.

  Scenario: A project member reads its own filtered tickets
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket?filter[state]=spec"
    Then the API response status is 200
    And the API collection contains "ticket.home"
    And the API collection excludes "ticket.other"

  Scenario Outline: Missing project authority returns an empty successful collection
    Given the API client is "<account>"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket?filter[state]=spec"
    Then the API response status is 200
    And the API collection is empty

    Examples:
      | account            |
      | no-bakery       |
      | fixture-workspace-only |

  Scenario: A crew roster is query-filtered rather than omitted after access checks
    Given the API client is "fixture-api-roster"
    When the API client reads "/jsonapi/og_membership/default?filter[entity_type]=bb_team&filter[state]=active"
    Then the API response status is 200
    And the API collection contains "membership.crew-mate.team.home"
    And the API collection excludes "membership.crew-mate.team.other"
    And the API collection has no omitted rows

  Scenario: The user collection lists local people without leaking foreign people
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/user/user"
    Then the API response status is 200
    And the API collection contains "user.member"
    And the API collection excludes "user.foreign"
    And the API collection has no omitted rows

  Scenario: A foreign person's individual resource exposes only its label
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/user/user/{user.foreign}"
    Then the API response status is 200
    And the foreign account exposes only its display name
