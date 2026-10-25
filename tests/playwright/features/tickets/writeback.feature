@functional @api
Feature: Ticket writeback through the JSON API
  A member may write in its own project. Workflow validation and tenancy
  boundaries remain enforced for real HTTP writes.

  Scenario: An allowed ticket transition survives a fresh read
    Given the API client is "north-contributor"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API workflow contract","workflow":"bb_work"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "ticket"
    Given the session actor owns a running lease for ticket "ticket"
    And the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"plan"}}}
      """
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"plan"}}}
      """

  Scenario: An illegal transition is rejected without changing the stored state
    Given the API client is "north-contributor"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API invalid transition","workflow":"bb_work"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "ticket"
    Given the session actor owns a running lease for ticket "ticket"
    And the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"done"}}}
      """
    Then the API response status is 422
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"qualification"}}}
      """

  Scenario: A session actor cannot create a ticket in the foreign project
    Given the API client is "fixture-api-session"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API forbidden create","workflow":"bb_work"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.other}"}}}}}
      """
    Then the API response status is 422
    And the API error mentions "tenancy"
