@functional @api
Feature: Conductor assignment follows local authority
  Ordinary members, leads and apps can assign within their project. A lead
  grant in another workspace must not grant access to this workspace.

  # BB-462 F5: `api-foreign-lead` used to pass here (201/200) because
  # direct PROJECT membership (now retired, D7) carried the implicit
  # `member` rank's create/update rights. What is left of this account's
  # reach to "home" is TEAM membership alone, and D3 keeps a team's own
  # role set empty by design — teams carry visibility, not rights — so a
  # pure team member with no workspace tier of their own genuinely has no
  # path to `create`/`update any bb_ticket` any more. That is the model
  # working as specified, not a regression: the confirmed test plan's own
  # "local contributor allowed, foreign actor denied" split (already
  # applied to group-team-create.feature) applies here too.
  Scenario Outline: Creating an assigned ticket checks the actor's local rank
    Given the API client is "<actor>"
    When the API client sends "POST" to "/jsonapi/bb_ticket/bb_ticket":
      """
      {"data":{"type":"bb_ticket--bb_ticket","attributes":{"title":"Assigned API ticket","workflow":"bb_feature"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.home}"}}}}}
      """
    Then the conductor assignment outcome is <status>

    Examples:
      | actor            | status |
      | api-lead         | 201    |
      | api-app          | 201    |
      | api-foreign-lead | 403    |
      | api-member       | 201    |
      | api-foreign-only | 403    |

  Scenario Outline: Reassigning an existing ticket checks the actor's local rank
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    Given the API client is "<actor>"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{conductor.home}"}}}}}
      """
    Then the conductor assignment outcome is <status>

    Examples:
      | actor            | status |
      | api-lead         | 200    |
      | api-app          | 200    |
      | api-foreign-lead | 403    |
      | api-member       | 200    |
      | api-foreign-only | 403    |
