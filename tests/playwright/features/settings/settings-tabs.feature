@feature:settings-tabs
Feature: Settings tabs edit their entity
  A Settings tab is the entity's own edit form. Workspace, project and group
  Settings save on an explicit Save through a native page round trip, never
  on blur, and land back on the same Settings screen with Drupal's ordinary
  status message. An edit left unsaved is discarded, with no warning. Each
  scenario edits a disposable workspace world of its own, so no seeded
  fixture name changes under a concurrent worker. Teams have no Settings tab:
  they are edited on their detail page cards (features/entity-detail).

  Scenario Outline: <surface> Settings changes wait for Save
    Given I lead a disposable workspace world
    When I open the <surface> Settings
    And I set the name to "Edited <surface>" and leave the field
    Then the <surface> name is still stored unchanged
    And Save is visible and reachable by keyboard
    And the form Save sits at the right of the action row below its fields
    When I save the Settings
    Then the <surface> name is stored as "Edited <surface>"
    And I am on the <surface> Settings with a saved message
    And the saved confirmation is a toast that hides again
    When I set the name to "Edited <surface> twice" and save the Settings
    Then the <surface> name is stored as "Edited <surface> twice"

    Examples:
      | surface   |
      | workspace |
      | project   |
      | group     |

  Scenario: Settings opened by its tab save with the page's own assets
    Given I lead a disposable workspace world
    When I open the project page
    And I click the tab "Runs"
    And I click the tab "Settings"
    And I set the name to "Saved from the tab" and save the Settings
    Then the project name is stored as "Saved from the tab"
    And I am on the project Settings with a saved message
    And the page loaded its own assets without htmx transport keys
    When I click the tab "Runs"
    And I click the tab "Settings"
    And I submit the name empty past browser validation
    Then the name is reported as required
    And the page loaded its own assets without htmx transport keys

  Scenario: The workspace slug and Settings address survive a rename
    Given I lead a disposable workspace world
    When I open the workspace Settings
    And I set the name to "Renamed workspace" and save the Settings
    Then the workspace slug is unchanged
    And I am on the workspace Settings with a saved message

  Scenario: Workspace Settings explain that run-log storage is unavailable
    Given I lead a disposable workspace world
    When I open the workspace Settings
    Then run-log storage is shown as unavailable without a checkbox
    When I set the name to "No run logs here" and save the Settings
    Then the workspace run-log opt-in is stored as off

  Scenario: Invalid Settings can be corrected
    Given I lead a disposable workspace world
    When I open the project Settings
    And I submit the name empty past browser validation
    Then the name is reported as required
    And the project name is still stored unchanged
    When I set the name to "Corrected project" and save the Settings
    Then the project name is stored as "Corrected project"

  Scenario: Leaving without Save discards the edit
    Given I lead a disposable workspace world
    When I open the project Settings
    And I set the name to "Never saved" and leave the field
    And I reload the page
    Then the name field shows the stored project name

  Scenario: A Settings submission with a forged form token writes nothing
    Given I lead a disposable workspace world
    When I open the project Settings
    And I set the name to "Forged" and submit with a tampered form token
    Then the project name is still stored unchanged

  Scenario: An outsider cannot open the Settings
    Given I lead a disposable workspace world
    When a stranger requests the project Settings
    Then the stranger is denied
