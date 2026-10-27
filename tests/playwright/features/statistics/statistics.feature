@functional @api
Feature: Composite statistics figures selected by named contexts
  The statistics endpoint returns ordered groups of complete figures. Each
  figure carries its widget, filters, category axis, measurements, labels and
  empty state. Named project, team and user contexts drive ordinary Drupal
  Conditions and measurement bindings.

  Scenario: An authorized team lead reads their own user figures
    Given the API client is "fixture-crew-mate"
    And membership "membership.crew-mate.team.home" is granted role "bb_team-bb_team-lead"
    When the API client reads "/jsonapi/bakers/statistics?user_id={user.crew-mate}"
    Then the API response status is 200
    And the statistics discovery lists "user_overview"
    And the statistics discovery lists "user_flow"
    When the API client reads "/jsonapi/bakers/statistics/user_overview?user_id={user.crew-mate}"
    Then the API response status is 200
    And the figure value carries categories and measurements
    Given membership "membership.crew-mate.team.home" holds no extra role

  Scenario: Every account reads its own figures without a rank
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics?user_id={user.member}"
    Then the API response status is 200
    And the statistics discovery lists "user_overview"
    When the API client reads "/jsonapi/bakers/statistics/user_overview?user_id={user.member}"
    Then the API response status is 200

  Scenario: A member cannot read another account's figures
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics?user_id={user.foreign}"
    Then the API response status is 200
    And the statistics discovery omits "user_overview"
    When the API client reads "/jsonapi/bakers/statistics/user_overview?user_id={user.foreign}"
    Then the API response status is 403

  Scenario: The unscoped read has no answer
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics"
    Then the API response status is 400
    When the API client reads "/jsonapi/bakers/statistics/user_overview"
    Then the API response status is 403

  Scenario: An unresolvable named context is refused
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics?user_id=00000000-0000-4000-8000-000000000000"
    Then the API response status is 404
    When the API client reads "/jsonapi/bakers/statistics/user_overview?user_id=00000000-0000-4000-8000-000000000000"
    Then the API response status is 403

  Scenario: A project member sees the project overview
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics?project_id={project.home}"
    Then the API response status is 200
    And the statistics discovery lists "project_overview"
    When the API client reads "/jsonapi/bakers/statistics/project_overview?project_id={project.home}"
    Then the API response status is 200
    And the figure value carries categories and measurements

  Scenario: A team member sees the project breakdown but not the lead-only member breakdown
    Given the API client is "fixture-crew-mate"
    When the API client reads "/jsonapi/bakers/statistics?team_id={team.home}"
    Then the API response status is 200
    And the statistics discovery lists "team_projects"
    And the statistics discovery omits "team_members"

  Scenario: Granting the team lead rank discloses the member breakdown
    Given the API client is "fixture-crew-mate"
    And membership "membership.crew-mate.team.home" is granted role "bb_team-bb_team-lead"
    When the API client reads "/jsonapi/bakers/statistics?team_id={team.home}"
    Then the API response status is 200
    And the statistics discovery lists "team_members"
    When the API client reads "/jsonapi/bakers/statistics/team_members?team_id={team.home}&filter[period]=month"
    Then the API response status is 200
    And the figure value carries categories and measurements
    Given membership "membership.crew-mate.team.home" holds no extra role
    When the API client reads "/jsonapi/bakers/statistics?team_id={team.home}"
    Then the API response status is 200
    And the statistics discovery omits "team_members"

  Scenario: A workspace lead reads the workspace Insights figures
    Given the API client is "fixture-lead"
    When the API client reads "/jsonapi/bakers/statistics?workspace_id={workspace.home}"
    Then the API response status is 200
    And the statistics discovery lists "workspace_overview"
    And the statistics discovery lists "workspace_people"
    When the API client reads "/jsonapi/bakers/statistics/workspace_overview?workspace_id={workspace.home}"
    Then the API response status is 200
    And the figure value carries categories and measurements

  Scenario: A workspace contributor cannot read the workspace Insights figures
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bakers/statistics?workspace_id={workspace.home}"
    Then the API response status is 200
    And the statistics discovery omits "workspace_overview"
    When the API client reads "/jsonapi/bakers/statistics/workspace_overview?workspace_id={workspace.home}"
    Then the API response status is 403

  Scenario Outline: An account with no membership is disclosed no figures
    Given the API client is "<account>"
    When the API client reads "/jsonapi/bakers/statistics?project_id={project.home}"
    Then the API response status is 200
    And the statistics discovery omits "project_overview"
    When the API client reads "/jsonapi/bakers/statistics?team_id={team.home}"
    Then the API response status is 200
    And the statistics discovery omits "team_projects"
    When the API client reads "/jsonapi/bakers/statistics?workspace_id={workspace.home}"
    Then the API response status is 200
    And the statistics discovery omits "workspace_overview"

    Examples:
      | account            |
      | no-bakery       |
      | fixture-api-stats-outsider |
