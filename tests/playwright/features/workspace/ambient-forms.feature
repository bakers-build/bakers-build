@functional @browser-contract
Feature: Ambient workspace form contracts
  The route supplies creation context and autocomplete settings preserve it
  even for an actor who can see both workspaces.

  Scenario Outline: All workspace add routes render for a workspace lead
    Given the browser uses recipe account "lead"
    When the contract browser opens "/bakers/<kind>/add" with status 200

    Examples:
      | kind    |
      | group   |
      | team    |
      | project |
      | ticket  |

  Scenario Outline: Creating within a workspace hides the picker and persists the workspace
    Given the browser uses recipe account "lead"
    When the contract browser opens "/bakers/<kind>/add" with status 200
    Then the contract field "workspace_id[0][target_id]" is absent
    And the contract page contains "Workspace: Northside Bakery"
    When the browser creates a scoped "<kind>" named "BDD ambient <kind>"

    Examples:
      | kind  |
      | group |
      | team  |

  Scenario Outline: Autocomplete stays within the route's workspace for a lead in both workspaces
    Given the browser uses recipe account "dual-lead"
    When the contract browser opens "/bakers/<kind>/add" with status 200
    Then the autocomplete "<field>" offers only the current workspace

    Examples:
      | kind    | field                    |
      | project | group_id[0][target_id]    |
      | ticket  | project_id[0][target_id]  |

  Scenario: Editing a group hides its workspace picker
    Given the browser uses recipe account "lead"
    When the contract browser opens the edit form for fixture "group.home"
    Then the contract field "workspace_id[0][target_id]" is absent

  Scenario: Environments can only be created within a project
    Given the browser uses recipe account "lead"
    When the contract browser opens "/admin/bakers/environment/add" with status 404
    And the contract browser opens "/bakers/environment/add" with status 404
    And the contract browser opens "/bakers/project/apih/environment/add" with status 200
    Then the contract field "project_id[0][target_id]" is absent
    When the browser creates a scoped "environment" named "BDD project environment"
