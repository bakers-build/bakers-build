@functional @api
Feature: Workspace API access
  A permitted account can resolve and list its workspace while an account
  without a workspace grant cannot read the individual resource.

  Scenario: A workspace member resolves and lists its workspace
    Given the API client is "api-member"
    When the API client reads "/jsonapi/bb_workspace/bb_workspace/{workspace.home}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"id":"{workspace.home}","attributes":{"name":"API home"}}}
      """
    When the API client reads "/jsonapi/bb_workspace/bb_workspace"
    Then the API response status is 200
    And the API collection contains "workspace.home"
    And the API collection excludes "workspace.other"

  Scenario: An account without a workspace grant cannot resolve the resource
    Given the API client is "api-stranger"
    When the API client reads "/jsonapi/bb_workspace/bb_workspace/{workspace.home}"
    Then the API response status is 403
