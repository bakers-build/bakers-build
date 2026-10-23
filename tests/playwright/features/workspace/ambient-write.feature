@functional @api
Feature: Ambient workspace validation over JSON API

  Scenario: Workspace lead creating bb_group in home gets 201
    Given the API client is "fixture-lead"
    When the API client sends "POST" to "/jsonapi/bb_group/bb_group":
      """
      {"data":{"type":"bb_group--bb_group","attributes":{"name":"API ambient contract"},"relationships":{"workspace_id":{"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "created"
    And the API client reads "/jsonapi/bb_group/bb_group/{saved.created}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"name":"API ambient contract"},"relationships":{"workspace_id":{"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}"}}}}}
      """

  Scenario: Workspace lead creating bb_group in other gets 422
    Given the API client is "fixture-lead"
    When the API client sends "POST" to "/jsonapi/bb_group/bb_group":
      """
      {"data":{"type":"bb_group--bb_group","attributes":{"name":"API ambient contract"},"relationships":{"workspace_id":{"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.other}"}}}}}
      """
    Then the API response status is 422
    And the API error mentions "workspace_id"
    And the API error mentions "not one of yours"

  Scenario: Workspace lead creating bb_ticket in home gets 201
    Given the API client is "fixture-lead"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API ambient contract","workflow":"bb_feature"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "created"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.created}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"title":"API ambient contract","workflow":"bb_feature"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}}}}}
      """

  Scenario: Workspace lead creating bb_ticket in other gets 422
    Given the API client is "fixture-lead"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API ambient contract","workflow":"bb_feature"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.other}"}}}}}
      """
    Then the API response status is 422
    And the API error mentions "project_id"
    And the API error mentions "not one of yours"
