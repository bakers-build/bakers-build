@functional @api
Feature: Machine registration requires workspace rank

  Scenario: fixture-api-machine registration returns 422
    Given the API client is "fixture-api-machine"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection is empty
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-api-machine","label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine}"}}}}}
      """
    Then the API response status is 422

  Scenario: fixture-api-machine-view registration returns 422
    Given the API client is "fixture-api-machine-view"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection is empty
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-api-machine-view","label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine-view}"}}}}}
      """
    Then the API response status is 422

  Scenario: fixture-api-machine-app registration returns 201
    Given the API client is "fixture-api-machine-app"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection contains "project.home"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-api-machine-app","label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine-app}"}}}}}
      """
    Then the API response status is 201


  Scenario: The test world grants no bakers.build capability to every authenticated account
    Then authenticated accounts receive no implicit bakers.build capability

  Scenario: Assignment has no dedicated permission declaration
    Then conductor assignment declares no separate permission
