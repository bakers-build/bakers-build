@functional @api
Feature: Conductor claims over HTTP
  A conductor claims its queue once, in priority order, across allowed states.

  Scenario: Priority orders the queue before it becomes empty
    Given the API client is "site-admin"
    And the API client identifies as the bakers CLI "0.7.0"
    When the API client creates a "bb_work" ticket in "home" as "first"
    And the API client creates a "bb_work" ticket in "home" as "second"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-claim-{saved.first}","label":"BDD claim conductor","states":["plan","working"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.claim-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.first}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}","attributes":{"state":"plan","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.second}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.second}","attributes":{"state":"plan","priority":3},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    Given the API client is "fixture-claim-owner"
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"type":"bb_run--bb_run","relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}"}}}}}
      """
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"type":"bb_run--bb_run","relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.second}"}}}}}
      """
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 204

  Scenario: An empty state list serves both plan and working
    Given the API client is "site-admin"
    And the API client identifies as the bakers CLI "0.7.0"
    When the API client creates a "bb_work" ticket in "home" as "first"
    And the API client creates a "bb_work" ticket in "home" as "second"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-claim-{saved.first}","label":"BDD claim conductor","states":[],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.claim-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.first}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}","attributes":{"state":"plan","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.second}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.second}","attributes":{"state":"plan","priority":3},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    When the API client changes ticket "second" to state "working"
    Then the API response status is 200
    Given the API client is "fixture-claim-owner"
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"type":"bb_run--bb_run","relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}"}}}}}
      """
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"type":"bb_run--bb_run","relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.second}"}}}}}
      """
    When the API client sends "POST" to "/jsonapi/bakers/claim-next":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 204

  Scenario: A specific ticket cannot be claimed twice
    Given the API client is "site-admin"
    And the API client identifies as the bakers CLI "0.7.0"
    When the API client creates a "bb_work" ticket in "home" as "first"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-claim-{saved.first}","label":"BDD claim conductor","states":["plan"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.claim-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.first}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}","attributes":{"state":"plan","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    Given the API client is "fixture-claim-owner"
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.first}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"type":"bb_run--bb_run","relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.first}"}}}}}
      """
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.first}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-claim-{saved.first}","lease_seconds":600}}}
      """
    Then the API response status is 409
