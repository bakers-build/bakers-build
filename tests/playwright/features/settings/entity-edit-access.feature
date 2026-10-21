@functional @api @feature:entity-edit-access
Feature: Entity edit access across browser, session token and CLI
  Workspace lead, referenced team lead, and machine/conductor owners may edit
  the fields the product exposes. A machine is edited on its detail page
  card; its form address here is the card's own route. Peers, foreign leads and rankless accounts
  are refused. Session tokens are real OAuth Bearers. Server-maintained fields
  stay read-only on a saved row.

  Scenario: Recipe edit actors hold ranks and no instance-admin permission
    Then the account "api-lead" does not have permission "administer bakers"
    And the account "api-conductor-owner" does not have permission "administer bakers"
    And the account "api-member" does not have permission "administer bakers"
    And the account "api-edit-team-lead" does not have permission "administer bakers"
    And the account "api-foreign-lead" does not have permission "administer bakers"
    And the account "api-stranger" does not have permission "administer bakers"
    And the account "login-admin" has permission "administer bakers"

  Scenario Outline: A permitted actor edits <fixture> in the browser and through the session token
    Given I am logged in as the account "<account>"
    When the contract browser opens the form of fixture "<fixture>" twice with status 200
    And the contract browser fills "<form_field>" with "<browser_value>" and saves
    And the contract browser reloads the form of fixture "<fixture>"
    Then the contract field "<form_field>" has value "<browser_value>"
    Given the API client is "<account>"
    When the API client reads "<collection>/<uuid>"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"<attribute>":<browser_json>}}}
      """
    When the API client sends "PATCH" to "<collection>/<uuid>":
      """
      {"data":{"type":"<type>","id":"<uuid>","attributes":{"<attribute>":<api_json>}}}
      """
    Then the API response status is 200
    When the contract browser reloads the form of fixture "<fixture>"
    Then the contract field "<form_field>" has value "<api_value>"

    Examples:
      | account              | fixture         | collection                              | uuid              | type                           | form_field             | browser_value           | browser_json              | api_value               | api_json                  | attribute    |
      | api-lead             | workspace.home  | /jsonapi/bb_workspace/bb_workspace  | {workspace.home}  | bb_workspace--bb_workspace | description[0][value]  | Workspace edited once   | "Workspace edited once"   | Workspace patched twice | "Workspace patched twice" | description  |
      | api-lead             | group.edit      | /jsonapi/bb_group/bb_group          | {group.edit}      | bb_group--bb_group         | name[0][value]         | Group edited once       | "Group edited once"       | Group patched twice     | "Group patched twice"     | name         |
      | api-lead             | project.edit    | /jsonapi/bb_project/bb_project      | {project.edit}    | bb_project--bb_project     | name[0][value]         | Project edited once     | "Project edited once"     | Project patched twice   | "Project patched twice"   | name         |
      | api-conductor-owner  | machine.edit    | /jsonapi/bb_machine/bb_machine      | {machine.edit}    | bb_machine--bb_machine     | max_parallel[0][value] | 5                       | 5                         | 6                       | 6                         | max_parallel |
      | api-conductor-owner  | conductor.edit  | /jsonapi/bb_conductor/bb_conductor  | {conductor.edit}  | bb_conductor--bb_conductor | label[0][value]        | Conductor edited once   | "Conductor edited once"   | Conductor patched twice | "Conductor patched twice" | label        |

  Scenario: A referenced team lead edits the project and cannot edit the workspace
    Given I am logged in as the account "api-edit-team-lead"
    When the contract browser opens the form of fixture "project.edit" twice with status 200
    And the contract browser fills "name[0][value]" with "Team lead edited project" and saves
    And the contract browser reloads the form of fixture "project.edit"
    Then the contract field "name[0][value]" has value "Team lead edited project"
    When the contract browser opens the form of fixture "workspace.home" twice with status 403
    Given the API client is "api-edit-team-lead"
    When the API client sends "PATCH" to "/jsonapi/bb_project/bb_project/{project.edit}":
      """
      {"data":{"type":"bb_project--bb_project","id":"{project.edit}","attributes":{"name":"Team lead patched project"}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_workspace/bb_workspace/{workspace.home}":
      """
      {"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}","attributes":{"description":"team-lead must not write"}}}
      """
    Then the API response status is 403

  Scenario Outline: A denied actor cannot PATCH <fixture> as <account>
    Given the API client is "<account>"
    When the API client sends "PATCH" to "<collection>/<uuid>":
      """
      {"data":{"type":"<type>","id":"<uuid>","attributes":{"<attribute>":<attempt>}}}
      """
    Then the API response status is 403
    Given the API client is "login-admin"
    When the API client reads "<collection>/<uuid>"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"<attribute>":<original>}}}
      """

    Examples:
      | account           | fixture         | collection                              | uuid              | type                           | attribute    | attempt                     | original              |
      | api-member        | workspace.home  | /jsonapi/bb_workspace/bb_workspace  | {workspace.home}  | bb_workspace--bb_workspace | description  | "peer must not write"       | null                  |
      | api-foreign-lead  | workspace.home  | /jsonapi/bb_workspace/bb_workspace  | {workspace.home}  | bb_workspace--bb_workspace | description  | "foreign must not write"    | null                  |
      | api-stranger      | workspace.home  | /jsonapi/bb_workspace/bb_workspace  | {workspace.home}  | bb_workspace--bb_workspace | description  | "stranger must not write"   | null                  |
      | api-member        | group.edit      | /jsonapi/bb_group/bb_group          | {group.edit}      | bb_group--bb_group         | name         | "peer must not write"       | "API edit group"      |
      | api-foreign-lead  | group.edit      | /jsonapi/bb_group/bb_group          | {group.edit}      | bb_group--bb_group         | name         | "foreign must not write"    | "API edit group"      |
      | api-stranger      | group.edit      | /jsonapi/bb_group/bb_group          | {group.edit}      | bb_group--bb_group         | name         | "stranger must not write"   | "API edit group"      |
      | api-member        | project.edit    | /jsonapi/bb_project/bb_project      | {project.edit}    | bb_project--bb_project     | name         | "peer must not write"       | "API edit project"    |
      | api-foreign-lead  | project.edit    | /jsonapi/bb_project/bb_project      | {project.edit}    | bb_project--bb_project     | name         | "foreign must not write"    | "API edit project"    |
      | api-stranger      | project.edit    | /jsonapi/bb_project/bb_project      | {project.edit}    | bb_project--bb_project     | name         | "stranger must not write"   | "API edit project"    |
      | api-member        | machine.edit    | /jsonapi/bb_machine/bb_machine      | {machine.edit}    | bb_machine--bb_machine     | max_parallel | 9                           | 4                     |
      | api-lead          | machine.edit    | /jsonapi/bb_machine/bb_machine      | {machine.edit}    | bb_machine--bb_machine     | max_parallel | 9                           | 4                     |
      | api-foreign-lead  | machine.edit    | /jsonapi/bb_machine/bb_machine      | {machine.edit}    | bb_machine--bb_machine     | max_parallel | 9                           | 4                     |
      | api-stranger      | machine.edit    | /jsonapi/bb_machine/bb_machine      | {machine.edit}    | bb_machine--bb_machine     | max_parallel | 9                           | 4                     |
      | api-member        | conductor.edit  | /jsonapi/bb_conductor/bb_conductor  | {conductor.edit}  | bb_conductor--bb_conductor | label        | "peer must not write"       | "API edit conductor"  |
      | api-lead          | conductor.edit  | /jsonapi/bb_conductor/bb_conductor  | {conductor.edit}  | bb_conductor--bb_conductor | label        | "lead must not write"       | "API edit conductor"  |
      | api-stranger      | conductor.edit  | /jsonapi/bb_conductor/bb_conductor  | {conductor.edit}  | bb_conductor--bb_conductor | label        | "stranger must not write"   | "API edit conductor"  |

  Scenario Outline: A denied actor cannot open the <fixture> form as <account>
    Given I am logged in as the account "<account>"
    When the contract browser opens the form of fixture "<fixture>" twice with status <status>

    Examples:
      | account           | fixture         | status |
      | api-member        | workspace.home  | 403    |
      | api-foreign-lead  | workspace.home  | 403    |
      | api-stranger      | workspace.home  | 403    |
      | api-member        | group.edit      | 403    |
      | api-foreign-lead  | group.edit      | 403    |
      | api-stranger      | group.edit      | 403    |
      | api-member        | project.edit    | 403    |
      | api-foreign-lead  | project.edit    | 403    |
      | api-stranger      | project.edit    | 403    |
      | api-member        | machine.edit    | 403    |
      | api-lead          | machine.edit    | 403    |
      | api-foreign-lead  | machine.edit    | 403    |
      | api-stranger      | machine.edit    | 403    |
      | api-member        | conductor.edit  | 403    |
      | api-lead          | conductor.edit  | 403    |
      | api-foreign-lead  | conductor.edit  | 403    |
      | api-stranger      | conductor.edit  | 403    |

  Scenario: A delegated-human session token may edit a permitted row and is refused on a denied row
    Given the API client uses a session token for "api-lead"
    When the API client sends "PATCH" to "/jsonapi/bb_group/bb_group/{group.edit}":
      """
      {"data":{"type":"bb_group--bb_group","id":"{group.edit}","attributes":{"name":"OAuth human patched group"}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_machine/bb_machine/{machine.edit}":
      """
      {"data":{"type":"bb_machine--bb_machine","id":"{machine.edit}","attributes":{"max_parallel":9}}}
      """
    Then the API response status is 403
    Given the API client uses a session token for "api-stranger"
    When the API client sends "PATCH" to "/jsonapi/bb_group/bb_group/{group.edit}":
      """
      {"data":{"type":"bb_group--bb_group","id":"{group.edit}","attributes":{"name":"OAuth stranger patched group"}}}
      """
    Then the API response status is 403

  Scenario: An owner-bound client-credentials token may edit its machine and is refused on a workspace
    Given the API client uses the owner client-credentials session token
    When the API client sends "PATCH" to "/jsonapi/bb_machine/bb_machine/{machine.edit}":
      """
      {"data":{"type":"bb_machine--bb_machine","id":"{machine.edit}","attributes":{"max_parallel":7}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_workspace/bb_workspace/{workspace.home}":
      """
      {"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}","attributes":{"description":"scope without rank"}}}
      """
    Then the API response status is 403

  Scenario: A mixed allowed and protected PATCH writes neither value
    Given the API client is "api-lead"
    When the API client sends "PATCH" to "/jsonapi/bb_workspace/bb_workspace/{workspace.home}":
      """
      {"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}","attributes":{"description":"mixed must not stick","slug":"hacked-slug"}}}
      """
    Then the API response status is 403
    When the API client reads "/jsonapi/bb_workspace/bb_workspace/{workspace.home}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"slug":"api-home","description":null}}}
      """
    Given the API client is "api-conductor-owner"
    When the API client sends "PATCH" to "/jsonapi/bb_machine/bb_machine/{machine.edit}":
      """
      {"data":{"type":"bb_machine--bb_machine","id":"{machine.edit}","attributes":{"max_parallel":8,"current_load":3}}}
      """
    Then the API response status is 403
    When the API client reads "/jsonapi/bb_machine/bb_machine/{machine.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"max_parallel":4,"current_load":0}}}
      """
    Given the API client is "api-lead"
    When the API client sends "PATCH" to "/jsonapi/bb_project/bb_project/{project.edit}":
      """
      {"data":{"type":"bb_project--bb_project","id":"{project.edit}","attributes":{"name":"mixed next_number must not stick","next_number":99}}}
      """
    Then the API response status is 403
    When the API client reads "/jsonapi/bb_project/bb_project/{project.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"name":"API edit project","next_number":1}}}
      """

  Scenario: A project cannot take a team from another workspace
    Given the API client is "api-lead"
    When the API client sends "PATCH" to "/jsonapi/bb_project/bb_project/{project.edit}":
      """
      {"data":{"type":"bb_project--bb_project","id":"{project.edit}","attributes":{"name":"foreign team must not stick"},"relationships":{"teams":{"data":[{"type":"bb_team--bb_team","id":"{team.other}"}]}}}}
      """
    Then the API response status is 422
    When the API client reads "/jsonapi/bb_project/bb_project/{project.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"name":"API edit project"},"relationships":{"teams":{"data":[{"type":"bb_team--bb_team","id":"{team.home}"}]}}}}
      """

  # The owner edits the machine on its detail page Identity card; the
  # instance admin keeps the administrative maintenance form.
  Scenario: Protected widgets are absent on ordinary forms and present for the instance admin
    Given I am logged in as the account "api-lead"
    When the contract browser opens the form of fixture "workspace.home" twice with status 200
    Then the contract field "slug[0][value]" is absent
    Given I am logged in as the account "api-conductor-owner"
    When the contract browser opens the form of fixture "machine.edit" twice with status 200
    Then the contract field "current_load[0][value]" is absent
    Given I am logged in as the account "login-admin"
    When the contract browser opens the administrative form of fixture "machine.edit" twice with status 200
    Then the contract field "current_load[0][value]" is visible
    Given the API client is "login-admin"
    When the API client sends "PATCH" to "/jsonapi/bb_machine/bb_machine/{machine.edit}":
      """
      {"data":{"type":"bb_machine--bb_machine","id":"{machine.edit}","attributes":{"current_load":2}}}
      """
    Then the API response status is 200
    When the API client sends "PATCH" to "/jsonapi/bb_machine/bb_machine/{machine.edit}":
      """
      {"data":{"type":"bb_machine--bb_machine","id":"{machine.edit}","attributes":{"current_load":0}}}
      """
    Then the API response status is 200

  Scenario Outline: dropsh updates a permitted row and a peer is refused
    Given dropsh uses a session token for "<account>"
    When dropsh updates "<resource>" with "<flag>" "<value>"
    Then dropsh exits 0
    Given the API client is "<account>"
    When the API client reads "<collection>/<uuid>"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"<attribute>":<json>}}}
      """

    Examples:
      | account              | resource                                  | flag          | value                    | collection                              | uuid             | attribute    | json                       |
      | api-lead             | bb_workspace/bb_workspace/{workspace.home} | --description | dropsh workspace name    | /jsonapi/bb_workspace/bb_workspace  | {workspace.home} | description  | "dropsh workspace name"    |
      | api-lead             | bb_group/bb_group/{group.edit}        | --name        | dropsh group name        | /jsonapi/bb_group/bb_group          | {group.edit}     | name         | "dropsh group name"        |
      | api-lead             | bb_project/bb_project/{project.edit}  | --name        | dropsh project name      | /jsonapi/bb_project/bb_project      | {project.edit}   | name         | "dropsh project name"      |
      | api-conductor-owner  | bb_machine/bb_machine/{machine.edit}  | --max_parallel | 6                       | /jsonapi/bb_machine/bb_machine      | {machine.edit}   | max_parallel | 6                          |
      | api-conductor-owner  | bb_conductor/bb_conductor/{conductor.edit} | --label  | dropsh conductor label   | /jsonapi/bb_conductor/bb_conductor  | {conductor.edit} | label        | "dropsh conductor label"   |

  Scenario: A peer dropsh update of a foreign machine is refused
    Given dropsh uses a session token for "api-member"
    When dropsh updates "bb_machine/bb_machine/{machine.edit}" with "--max_parallel" "9"
    Then dropsh reports a server 403
    Given the API client is "login-admin"
    When the API client reads "/jsonapi/bb_machine/bb_machine/{machine.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"max_parallel":4}}}
      """

  Scenario: Conductor heartbeat and offline preserve owner edits and refuse peers
    Given the API client uses the owner client-credentials session token
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"api-edit-conductor","host_key":"api-edit-host","project":"API home","states":["coding"],"workspace_root":"/tmp/api-edit","label":"heartbeat must not win","max_parallel":99}}}
      """
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_conductor/bb_conductor/{conductor.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"id":"{conductor.edit}","attributes":{"label":"API edit conductor","status":"online"}}}
      """
    When the API client sends "PATCH" to "/jsonapi/bb_conductor/bb_conductor/{conductor.edit}":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}","attributes":{"label":"Owner lifecycle label"}}}
      """
    Then the API response status is 200
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"api-edit-conductor","host_key":"api-edit-host","project":"API home","states":["coding"],"workspace_root":"/tmp/api-edit","label":"heartbeat must not win","max_parallel":99,"current_load":2,"lease_seconds":300}}}
      """
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_conductor/bb_conductor/{conductor.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"label":"Owner lifecycle label","status":"online"}}}
      """
    When the API client sends "PATCH" to "/jsonapi/bb_conductor/bb_conductor/{conductor.edit}":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}","attributes":{"status":"offline"}}}
      """
    Then the API response status is 403
    When the API client sends "POST" to "/jsonapi/bb_conductor/{conductor.edit}/offline":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}"}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":"offline"}}}
      """
    When the API client sends "POST" to "/jsonapi/bb_conductor/{conductor.edit}/offline":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}"}}
      """
    Then the API response status is 200
    Given the API client uses a session token for "api-member"
    When the API client sends "POST" to "/jsonapi/bb_conductor/{conductor.edit}/offline":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}"}}
      """
    Then the API response status is 403
    Given the API client uses a session token for "api-lead"
    When the API client sends "POST" to "/jsonapi/bb_conductor/{conductor.edit}/offline":
      """
      {"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.edit}"}}
      """
    Then the API response status is 403
    Given the API client uses the owner client-credentials session token
    When the API client sends "POST" to "/jsonapi/bakers/heartbeat":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"api-edit-conductor","host_key":"api-edit-host","project":"API home","states":["coding"],"workspace_root":"/tmp/api-edit","current_load":1,"lease_seconds":300}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":"online","label":"Owner lifecycle label"}}}
      """
    When the API client reads "/jsonapi/bb_machine/bb_machine/{machine.edit}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"max_parallel":4}}}
      """
