@functional @api
Feature: Workflow-specific completion
  Bugs and chores may finish from coding. Features retain mandatory review.

  Scenario Outline: Completion from coding follows the selected workflow
    Given the API client is "north-contributor"
    When the API client creates a "<workflow>" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "<entry>"
    Then the API response status is 200
    When the API client changes ticket "ticket" to state "coding"
    Then the API response status is 200
    Given the session actor owns a running lease for ticket "ticket"
    When the API client changes ticket "ticket" to state "done"
    Then the API response status is <status>
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"<stored>"}}}
      """

    Examples:
      | workflow     | entry    | status | stored |
      | bb_chore   | spec     | 200    | done   |
      | bb_bug     | diagnose | 200    | done   |
      | bb_feature | spec     | 422    | coding |
