@functional @api @feature:ticket-templates-api
Feature: Ticket templates over JSON:API
  A workspace lead reads a template and instantiates it through the endpoint.
  Every call answers 201 with a new ticket; a body overrides single fields of
  the template. A workspace template needs the project in the body. Unknown
  templates are 404 and an anonymous caller is asked to authenticate (401).
  The tickets a scenario creates are deleted after it, so a second run starts
  from the same world.

  Scenario: A lead reads the fixture template
    Given the API client is "template-manager"
    When the API client reads "/jsonapi/bb_ticket_template/bb_ticket_template/{template.fixture}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"name":"Fixture template","enabled":true}}}
      """

  Scenario: Instantiating twice creates two tickets
    Given the API client is "template-manager"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.fixture}/instantiate":
      """
      {}
      """
    And the API resource is remembered as "first"
    And the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.fixture}/instantiate":
      """
      {}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"meta":{"created":true},"data":{"type":"bb_ticket--bb_ticket"}}
      """
    And the API resource is not "first"

  Scenario: A workspace template creates the ticket in the passed project
    Given the API client is "template-manager"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.workspace}/instantiate":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"Workspace probe"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.templates}"}}}}}
      """
    Then the API response status is 201
    And the API document contains:
      """
      {"data":{"attributes":{"title":"Workspace probe"},"relationships":{"project_id":{"data":{"id":"{project.templates}"}}}}}
      """

  Scenario: A workspace template without a project is rejected
    Given the API client is "template-manager"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.workspace}/instantiate":
      """
      {}
      """
    Then the API response status is 422
    And the API error mentions "A project is required for a workspace template."

  Scenario Outline: <actor> may not use the workspace template
    Given the API client is "<actor>"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.workspace}/instantiate":
      """
      {"data":{"type":"bb_ticket--bb_ticket","relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.templates}"}}}}}
      """
    Then the API response status is <status>

    Examples:
      | actor          | status |
      | other-member   | 404    |
      | addon-reviewer | 403    |
      | anonymous      | 401    |

  Scenario: An unknown template is not found
    Given the API client is "template-manager"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/11111111-2222-4333-8444-555555555555/instantiate":
      """
      {}
      """
    Then the API response status is 404

  Scenario: An anonymous caller must authenticate
    Given the API client is "anonymous"
    When the API client sends "POST" to "/jsonapi/bb_ticket_template/bb_ticket_template/{template.fixture}/instantiate":
      """
      {}
      """
    Then the API response status is 401
