@feature:addons-overview
Feature: Workspace addon overview
  Settings › Addons lists every registered addon once, at its newest version,
  with all its versions. The conductor cell shows only the viewer's conductors
  of the current workspace, each with the version it runs. Only workspace
  leads reach the tab. The tab row is an island, so a navigating scenario
  clicks twice: a declaration lost in a swap survives the first click.

  Background:
    Given a probe addon at version "1.0.0" runs on the conductor "srv01-bakers"
    And the probe addon has a newer version "1.1.0"

  Scenario: A workspace lead sees the addon with its versions and conductor
    Given I am signed in as "cwiedemann"
    When I open the workspace settings of "bakers"
    And I click the tab "Addons"
    And I click the tab "Addons"
    Then the tab "Addons" is current
    And the addon overview lists the probe addon once with the versions "1.1.0, 1.0.0"
    And the probe addon row shows the conductor "srv01-bakers 1.0.0"
    And the probe addon row shows its icon
    And the rail has no entry "Addons"

  Scenario: A lead of another workspace does not see the first workspace's addon
    Given I am signed in as "api-foreign-lead"
    When I open the addon overview of "api-other"
    Then the addon overview does not list the probe addon

  Scenario: A member who does not lead the workspace cannot open the tab
    Given I am signed in as "other-member"
    When I request the addon overview of "other"
    Then access to the addon overview is denied
