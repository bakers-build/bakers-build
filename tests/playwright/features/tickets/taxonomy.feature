@functional @api
Feature: Label relationships and conductor states
  Normalized labels and state lists survive independent API reads.

  Scenario: Label references and conductor states are writable and persisted
    Given the API client is "site-admin"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    And the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-taxonomy-{saved.ticket}","label":"BDD taxonomy","states":["diagnose"]},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.conductor-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    And the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"labels":{"data":[{"type":"bb_term--bb_labels","id":"{term.label}"}]}}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_conductor/bb_conductor/{saved.conductor}":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}","attributes":{"states":["diagnose","coding"]}}}
      """
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=labels"
    Then the API response status is 200
    And the API document includes resource "term.label"
    And the API document contains:
      """
      {"data":{"relationships":{"labels":{"data":[{"type":"bb_term--bb_labels","id":"{term.label}"}]}}}}
      """
    When the API client reads "/jsonapi/bb_conductor/bb_conductor/{saved.conductor}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"states":["diagnose","coding"]}}}
      """
