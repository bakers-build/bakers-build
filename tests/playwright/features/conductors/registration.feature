@functional @api
Feature: Machine registration requires workspace rank

  Scenario: fixture-api-machine registration returns 422
    Given the API client is "fixture-api-machine"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection is empty
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine}"}}}}}
      """
    Then the API response status is 422

  Scenario: fixture-api-machine-view registration returns 422
    Given the API client is "fixture-api-machine-view"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection is empty
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine-view}"}}}}}
      """
    Then the API response status is 422

  Scenario: fixture-api-machine-app registration returns 201
    Given the API client is "fixture-api-machine-app"
    When the API client reads "/jsonapi/bb_project/bb_project?filter[name]=API%20home"
    Then the API response status is 200
    And the API collection contains "project.home"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"label":"BDD registration"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.machine-app}"}}}}}
      """
    Then the API response status is 201

  Scenario: A heartbeat registers one conductor per machine, project and variant
    Given the API client is "fixture-api-machine-app"
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"machine_id":"5d0c7a4e-2b1f-4c3d-9e8a-7f6b5a4c3d21","machine_label":"bdd-registration-host","project":"API home","states":["plan"]}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"label":"bdd-registration-host · API home","variant":"conductor","status":"online"}}}
      """
    When the API resource is remembered as "conductor"
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"machine_id":"5d0c7a4e-2b1f-4c3d-9e8a-7f6b5a4c3d21","machine_label":"bdd-registration-host","project":"API home","variant":"conductor","states":["plan"]}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"id":"{saved.conductor}"}}
      """
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"machine_id":"5d0c7a4e-2b1f-4c3d-9e8a-7f6b5a4c3d21","machine_label":"bdd-registration-host","project":"API home","variant":"shop","states":["plan"]}}}
      """
    Then the API response status is 200
    And the API resource is not "conductor"
    And the API document contains:
      """
      {"data":{"attributes":{"label":"bdd-registration-host · API home/shop","variant":"shop"}}}
      """
    When the API client reads "/jsonapi/bb_conductor/bb_conductor?filter[machine.id]=5d0c7a4e-2b1f-4c3d-9e8a-7f6b5a4c3d21&filter[variant]=conductor"
    Then the API response status is 200
    And the API collection contains "saved.conductor"

  Scenario: A heartbeat of an old CLI is refused naming bakers init
    Given the API client is "fixture-api-machine-app"
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-old-cli","machine_id":"bdd-old-host","project":"API home"}}}
      """
    Then the API response status is 422
    And the API error mentions "bakers init"


  # Except reading one's own My work figures: another account's figures still
  # need a rank over that account.
  Scenario: The test world grants no bakers.build capability to every authenticated account
    Then authenticated accounts receive no implicit bakers.build capability

  Scenario: Assignment has no dedicated permission declaration
    Then conductor assignment declares no separate permission
