@feature:ticket-inline-properties
Feature: Ticket properties persist inline on an explicit Save
  A pick changes nothing until Save, exactly as on a Settings form: Save sits
  at the right of the action row below the properties, a completed save shows
  Drupal's ordinary status message as a toast, and the page stays put.

  Background:
    Given I am logged in as "Administrator"
    And I visit the ticket "BB-142"
    And I remember the inline properties for cleanup
    And the Properties block holds the property pickers and Created by

  Scenario: A conductor selection survives reload and can be cleared
    When I select inline "Conductor" option "srv01-bakers"
    And I save the inline properties
    Then the inline "Conductor" save succeeds without navigation
    And the Properties block holds the property pickers and Created by
    When I reload the page
    Then the inline "Conductor" selection is "srv01-bakers"
    When I select inline "Conductor" option "No conductor"
    And I save the inline properties
    Then the inline "Conductor" save succeeds without navigation
    When I reload the page
    Then the inline "Conductor" selection is empty

  Scenario Outline: Existing properties survive reload and support clearing
    When I select inline "<property>" option "<value>"
    And I save the inline properties
    Then the inline "<property>" save succeeds without navigation
    When I reload the page
    Then the inline "<property>" selection includes "<value>"
    When I select inline "<property>" option "<clear>"
    And I save the inline properties
    Then the inline "<property>" save succeeds without navigation
    When I reload the page
    Then the inline "<property>" selection is empty

    Examples:
      | property | value   | clear       |
      | Assignee | north-member | Unassigned  |
      | Priority | High    | No priority |
      | Labels   | bug     | No labels   |

  Scenario: Saving another property preserves earlier inline changes
    When I select inline "Priority" option "High"
    And I save the inline properties
    Then the inline "Priority" save succeeds without navigation
    When I select inline "Labels" option "bug"
    And I save the inline properties
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the inline "Priority" selection is "High"
    And the inline "Labels" selection includes "bug"

  Scenario: Dismissing a property does not write
    Then dismissing the current priority sends no save and leaves it unchanged

  Scenario: Picking a property writes nothing until Save
    Then picking inline "Priority" option "High" writes nothing until Save
    And the form Save sits at the right of the action row below its fields
    When I select inline "Priority" option "High"
    And I save the inline properties
    Then the saved confirmation is a toast that hides again

  Scenario: A rejected save retains the attempted selection and can be retried
    Given the next conductor save contains an invalid reference
    When I select inline "Conductor" option "srv01-bakers"
    And I save the inline properties
    Then the inline "Conductor" shows an unsaved error with the attempted value "Unavailable selection (2147483647)"
    And the Properties block holds the property pickers and Created by
    And the stored conductor is unchanged
    When I retry the rejected inline "Conductor" save
    Then the inline "Conductor" shows an unsaved error with the attempted value "Unavailable selection (2147483647)"
    When I correct the inline "Conductor" selection
    Then the inline "Conductor" save succeeds without navigation
    When I reload the page
    Then the inline "Conductor" selection is "srv01-bakers"

  Scenario: A denied save clears prior success and can be retried
    When I select inline "Priority" option "High"
    And I save the inline properties
    Then the inline "Priority" save succeeds without navigation
    Given browser authentication is removed without reloading
    When I save denied inline "Priority" option "Low"
    Then the inline property save is rejected with HTTP 403
    And the inline "Priority" shows an unsaved error with the attempted value "Low"
    And an authenticated reload shows stored inline "Priority" option "High"
    When I retry the rejected inline "Priority" save
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Priority" selection is "Low"

  Scenario: Inline writes enforce the field boundary and reference constraints
    Then invalid inline property requests are rejected without changing the ticket

  Scenario: Inline writes require update access and a session CSRF token
    Then the inline save refuses missing CSRF tokens and users without update access

  Scenario: Explicit Save is reusable on an ordinary non-ticket form
    Then an ordinary form saves only on Save through HTMX after each replacement

  Scenario: Label choices and their selection markers fit the viewport
    Then the inline Labels menu fits the viewport at desktop and mobile sizes

  Scenario: Multiple labels survive reload and removing one preserves the others
    When I select inline "Labels" option "No labels"
    And I save the inline properties
    Then the inline "Labels" save succeeds without navigation
    When I select inline "Labels" option "ui"
    And I save the inline properties
    Then the inline "Labels" save succeeds without navigation
    When I select inline "Labels" option "bug"
    And I save the inline properties
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the selected inline labels are "ui, bug"
    When I select inline "Labels" option "ui"
    And I save the inline properties
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the selected inline labels are "bug"

  Scenario: A stale form preserves another editor's property change
    Then separate stale property submissions preserve both editors changes

  Scenario: A second Save after the replacement persists without repeating an in-flight Save
    Then a second Save after the replacement persists and an in-flight Save is not repeated

  Scenario: A cached property form cannot be replayed to another ticket
    Then a saved property form refuses a different ticket route
