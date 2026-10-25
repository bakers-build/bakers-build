@functional @api
Feature: Optional review before completion
  Every work ticket may finish from working; review is optional. Finishing
  still needs the work to have started: a planned ticket cannot finish.

  Scenario: A planned ticket cannot finish
    Given the API client is "north-contributor"
    When the API client creates a "bb_work" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "plan"
    Then the API response status is 200
    Given the session actor owns a running lease for ticket "ticket"
    When the API client changes ticket "ticket" to state "done"
    Then the API response status is 422
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"plan"}}}
      """

  Scenario: A working ticket finishes without review
    Given the API client is "north-contributor"
    When the API client creates a "bb_work" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "plan"
    Then the API response status is 200
    When the API client changes ticket "ticket" to state "working"
    Then the API response status is 200
    Given the session actor owns a running lease for ticket "ticket"
    When the API client changes ticket "ticket" to state "done"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"done"}}}
      """
