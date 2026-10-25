@functional @api
Feature: Deployment and verification API contracts
  Release batches and verification targets survive a fresh resource read.

  Scenario: Deployment starts at pre_deployment with both referenced tickets
    Given the API client is "north-contributor"
    When the API client creates a "bb_work" ticket in "home" as "first"
    And the API client creates a "bb_work" ticket in "home" as "second"
    And the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API release","workflow":"bb_deployment"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"referenced_tickets":{"data":[{"type":"bb_ticket--bb_ticket","id":"{saved.first}"},{"type":"bb_ticket--bb_ticket","id":"{saved.second}"}]}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "release"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.release}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"workflow":"bb_deployment","state":"pre_deployment"},"relationships":{"referenced_tickets":{"data":[{"id":"{saved.first}"},{"id":"{saved.second}"}]}}}}
      """

  Scenario: Verification starts at verifying with its parent and environment
    Given the API client is "north-contributor"
    When the API client creates a "bb_deployment" ticket in "home" as "release"
    And the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"API verification","workflow":"bb_verification"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"parent_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.release}"}},"environments":{"data":[{"type":"bb_environment--bb_environment","id":"{environment.home}"}]}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "verification"
    And the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.verification}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"workflow":"bb_verification","state":"verifying"},"relationships":{"parent_id":{"data":{"id":"{saved.release}"}},"environments":{"data":[{"id":"{environment.home}"}]}}}}
      """

  Scenario: Environment exposes its URL and branch to a project member
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bb_environment/bb_environment/{environment.home}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"base_url":"https://deployment.api-contract.test","branch":"api-contract-main"}}}
      """

  Scenario: Environment collection is filtered by deployment branch
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bb_environment/bb_environment"
    Then the API response status is 200
    And the API collection contains "environment.home"
    And the API collection contains "environment.other-branch"
    When the API client reads "/jsonapi/bb_environment/bb_environment?filter[branch]=api-contract-main"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":[{"id":"{environment.home}","attributes":{"branch":"api-contract-main"}}]}
      """
