@feature:application-states
Feature: Application absence and refusal have safe recovery paths

  Scenario: Anonymous missing pages retain the 404 and a fixed sign-in link
    Given I am logged in as "Anonymous"
    When the contract browser opens "/missing-application-page?destination=https://example.com" with status 404
    Then the error screen is 404 with the "signpost-missing" signpost
    And the recovery link is "Sign in" to "/user/login"

  Scenario: Members can recover from missing pages with native navigation twice
    Given the browser uses recipe account "member"
    When the contract browser opens "/missing-application-page" with status 404
    Then the error screen is 404 with the "signpost-missing" signpost
    And the recovery link is "Go to home" to "/home"
    When I follow the error recovery link twice from "/missing-application-page"
    Then the address is "/home"

  Scenario: A readable ticket's forbidden delete operation stays a 403
    Given the browser uses recipe account "member"
    When the contract browser opens "/api-home/ticket/{ticket.home}" with status 200
    And the contract browser opens "/api-home/ticket/{ticket.home}/delete" with status 403
    Then the error screen is 403 with the "signpost-denied" signpost
    And the recovery link is "Go to home" to "/home"

  Scenario: Foreign workspace entity access retains its existing 403
    Given the browser uses recipe account "foreign"
    When the contract browser opens "/api-other/ticket/{ticket.other}" with status 200
    And the contract browser opens "/api-home/ticket/{ticket.home}" with status 403
    Then the error screen is 403 with the "signpost-denied" signpost

  Scenario: Anonymous protected routes still redirect to authentication
    Given I am logged in as "Anonymous"
    When I request a protected ticket without following redirects
    Then the protected response is an authentication redirect

  Scenario: JSON API missing resources remain machine-readable errors
    Given the API client is "api-member"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/00000000-0000-4000-8000-000000000000"
    Then the API response status is 404
    And the API error remains JSON

  Scenario: JSON API denied resources retain their error format
    Given the API client is "api-member"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{ticket.other}"
    Then the API response status is 403
    And the API error remains JSON

  Scenario: Cached missing pages keep the recovery action specific to the current actor
    Given I am logged in as "Anonymous"
    When the contract browser opens "/missing-actor-cache" with status 404
    Then the recovery link is "Sign in" to "/user/login"
    Given the browser uses recipe account "member"
    When the contract browser opens "/missing-actor-cache" with status 404
    Then the recovery link is "Go to home" to "/home"
    Given I am logged in as "Anonymous"
    When the contract browser opens "/missing-actor-cache" with status 404
    Then the recovery link is "Sign in" to "/user/login"

  Scenario: A delayed and failed list request does not claim an empty success
    Given the browser uses recipe account "member"
    When the contract browser opens "/api-home/projects" with status 200
    Then a delayed failed project filter keeps its populated rows

  @nojs
  Scenario: Error recovery is usable without JavaScript
    Given the browser uses recipe account "member"
    When the contract browser opens "/missing-application-page" with status 404
    Then the recovery link is "Go to home" to "/home"
    When I follow the error recovery link twice from "/missing-application-page"
    Then the address is "/home"

  Scenario Outline: An empty workspace listing keeps its message and gains an inbox
    Given I am signed in as a member of the "other" workspace
    When the contract browser opens "/other/<listing>" with status 200
    Then the listing has one small inbox beside "<message>"
    Examples:
      | listing  | message            |
      | projects | No projects found. |
      | groups   | No groups found.   |

  Scenario Outline: A filter miss decorates the existing message without changing it
    Given the browser uses recipe account "member"
    When the contract browser opens "/api-home/<listing>" with status 200
    Then the populated listing has no empty state
    When the contract browser opens "/api-home/<listing>?title=no-such-listing-title" with status 200
    Then the listing has one small inbox beside "<message>"
    When the contract browser opens "/api-home/<listing>" with status 200
    Then the populated listing has no empty state
    Examples:
      | listing  | message            |
      | projects | No projects found. |
      | groups   | No groups found.   |
