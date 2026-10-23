@functional @browser-contract
Feature: Entity administration form contracts
  Existing form contracts run against the installed recipe in a real browser.

  Background:
    Given the browser uses recipe account "manager"

  Scenario Outline: Entity add forms retain their sidebar
    When the contract browser opens "<path>" with status 200
    Then the contract form has an entity sidebar

    Examples:
      | path                      |
      | /bakers/group/add       |
      | /bakers/project/add     |
      | /admin/bakers/conductor/add  |
      | /bakers/run/add         |
      | /bakers/ticket/add      |

  Scenario: Ticket sidebar contains the existing panels and label field
    When the contract browser opens "/bakers/ticket/add" with status 200
    Then the ticket sidebar exposes its panels and labels

  Scenario: Ticket creation exposes lifecycle controls and hides server-owned fields
    When the contract browser opens "/bakers/ticket/add" with status 200
    Then the contract field "title[0][value]" is visible
    And the contract field "identifier[0][value]" is absent
    And the contract field "state" is visible
    And the contract field "workflow" is visible
    And the contract field "closed[value]" is absent
    And the contract field "closed_date[0][value][date]" is absent

  Scenario: Ticket Settings offer only the exception fields and keep the identifier
    Given the API client is "north-contributor"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    And the contract browser opens "/bakers/ticket/{saved.ticket}/edit" with status 200
    Then the contract field "title[0][value]" is visible
    And the contract field "description[0][value]" is visible
    And the contract field "env_vars[0][value]" is visible
    And the contract field "identifier[0][value]" is absent
    And the contract field "priority" is absent
    And the contract field "parent_id" is absent
    And the contract field "state" is absent
    When the ticket is renamed through its form to "API renamed through browser"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"title":"API renamed through browser"}}}
      """
    And the stored ticket identifier still matches resource "ticket"

  Scenario: Ticket routes accept all three identities and refuse unknown UUIDs
    Given the API client is "north-contributor"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    Then the ticket routes resolve identifier, ID and UUID for "ticket"
    When the contract browser opens "/bakers/ticket/00000000-0000-4000-8000-000000000000" with status 404

  Scenario: Administrators retain the workspace picker
    When the contract browser opens "/bakers/group/add" with status 200
    Then the contract field "workspace_id[0][target_id]" is visible

  Scenario: The ticket page lists comment bodies and free-text comment types
    Given the API client is "north-contributor"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client sends "POST" to "/jsonapi/bb_comment/bb_comment":
      """
      {"data":{"type":"bb_comment--bb_comment","attributes":{"body":{"value":"BDD diagnosis text body","format":"bb_rich"},"bb_comment_type":"debug_diagnose"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the contract browser opens "/bakers/ticket/{saved.ticket}" with status 200
    Then the contract page contains "BDD diagnosis text body"
    And the contract page contains "debug_diagnose"
