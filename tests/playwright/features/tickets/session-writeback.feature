@functional @api
Feature: Session-scoped writeback contracts
  The actor has an active run and an ordinary membership, without app rank.

  Background:
    Given the API client is "north-contributor"
    When the API client creates a "bb_work" ticket in "home" as "ticket"
    Given the session actor owns a running lease for ticket "ticket"

  Scenario: An active session creates a child ticket and persists its parent
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API child","workflow":"bb_work"},"relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}},"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "child"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.child}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """

  Scenario: An active session creates a ticket under a parent outside its scope
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API out-of-scope child","workflow":"bb_work"},"relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.home}"}},"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "out-of-scope-child"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.out-of-scope-child}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.home}"}}}}}
      """

  Scenario: An active session re-parents its own ticket via update
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.home}"}}}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"relationships":{"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.home}"}}}}}
      """

  Scenario: An active session cannot patch a foreign ticket
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{ticket.other}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{ticket.other}","attributes":{"state":"working"}}}
      """
    Then the API response status is 403

  Scenario: An active session completes its own run
    When the API client sends "PATCH" to "/jsonapi/bb_run/bb_run/{saved.session-run}":
      """
      {"data":{"type":"bb_run--bb_run","id":"{saved.session-run}","attributes":{"state":"done"}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"done"}}}
      """

  Scenario: An active session stores ticket links
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"links":[{"uri":"https://example.test/mr/42","title":"MR !42"}]}}}
      """
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"links":[{"uri":"https://example.test/mr/42","title":"MR !42"}]}}}
      """
