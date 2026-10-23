@functional @api
Feature: Ticket comment relationships and writeback
  Comment types are extensible and ticket reads expose persisted comments,
  including changes after the same resource has already been requested.

  Scenario Outline: A comment's type and body survive insertion and a fresh ticket read
    Given the API client is "north-contributor"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    Given the session actor owns a running lease for ticket "ticket"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[]}}}}
      """
    When the API client sends "POST" to "/jsonapi/bb_comment/bb_comment":
      """
      {"data":{"type":"bb_comment--bb_comment","attributes":{"body":{"value":"BDD comment body","format":"bb_rich"},"bb_comment_type":"<type>"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "comment"
    And the API client reads "/jsonapi/bb_comment/bb_comment/{saved.comment}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"bb_comment_type":"<type>","body":{"value":"BDD comment body"}}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments"
    Then the API response status is 200
    And the API document includes resource "saved.comment"
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[{"type":"bb_comment--bb_comment","id":"{saved.comment}"}]}}}}
      """

    Examples:
      | type    |
      | comment |
      | retro   |

  Scenario: A foreign ticket cannot receive an in-scope actor's comment
    Given the API client is "fixture-api-session"
    When the API client sends "POST" to "/jsonapi/bb_comment/bb_comment":
      """
      {"data":{"type":"bb_comment--bb_comment","attributes":{"body":{"value":"Forbidden foreign comment","format":"bb_rich"},"bb_comment_type":"comment"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.other}"}}}}}
      """
    Then the API response status is 422

  Scenario: Deleting a comment invalidates a previously read ticket relationship
    Given the API client is "north-contributor"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    And the API client sends "POST" to "/jsonapi/bb_comment/bb_comment":
      """
      {"data":{"type":"bb_comment--bb_comment","attributes":{"body":{"value":"API comment to delete","format":"bb_rich"}},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "comment"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments"
    Then the API response status is 200
    And the API document includes resource "saved.comment"
    Given the API client is "site-admin"
    When the API client sends "DELETE" to "/jsonapi/bb_comment/bb_comment/{saved.comment}":
      """
      {}
      """
    Then the API response status is 204
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments"
    Then the API response status is 200
    And the API document excludes included resource "saved.comment"
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[]}}}}
      """
