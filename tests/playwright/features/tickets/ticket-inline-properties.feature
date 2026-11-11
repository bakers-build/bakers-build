@feature:ticket-inline-properties
Feature: Ticket properties save each pick on their own
  A pick is the write: the Details have no Save button while JavaScript runs,
  the field says "Saved" or names the error, and the page stays put. A pick on
  a field someone changed since the page loaded writes nothing and the page
  shows their value.

  Background:
    Given I am logged in as "Administrator"
    And I visit the ticket "BB-142"
    And I remember the inline properties for cleanup
    And the Properties block holds the property pickers and Created by

  Scenario: A conductor selection survives reload and can be cleared
    When I select inline "Conductor" option "srv01-bakers"
    Then the inline "Conductor" save succeeds without navigation
    And the Properties block holds the property pickers and Created by
    When I reload the page
    Then the inline "Conductor" selection is "srv01-bakers"
    When I select inline "Conductor" option "No conductor"
    Then the inline "Conductor" save succeeds without navigation
    When I reload the page
    Then the inline "Conductor" selection is empty

  Scenario Outline: Existing properties survive reload and support clearing
    When I select inline "<property>" option "<value>"
    Then the inline "<property>" save succeeds without navigation
    When I reload the page
    Then the inline "<property>" selection includes "<value>"
    When I select inline "<property>" option "<clear>"
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
    Then the inline "Priority" save succeeds without navigation
    When I select inline "Labels" option "bug"
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the inline "Priority" selection is "High"
    And the inline "Labels" selection includes "bug"

  Scenario: Dismissing a property does not write
    Then dismissing the current priority sends no save and leaves it unchanged

  Scenario: A pick saves itself
    Then the property form shows no Save button
    When I select inline "Priority" option "High"
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Priority" selection is "High"

  Scenario: A concurrent change of the same field is refused
    When another editor sets the priority of "BB-142" to "Low"
    And I select inline "Priority" option "High"
    Then the inline "Priority" says "Someone changed this meanwhile. The page shows their value."
    And the inline "Priority" selection is "Low"
    When I select inline "Priority" option "High"
    Then the inline "Priority" save succeeds without navigation
    When I reload the page
    Then the inline "Priority" selection is "High"

  Scenario: A rejected save retains the attempted selection and can be corrected
    Given the next conductor save contains an invalid reference
    When I select inline "Conductor" option "srv01-bakers"
    Then the inline "Conductor" shows an unsaved error with the attempted value "Unavailable selection (2147483647)"
    And the Properties block holds the property pickers and Created by
    And the stored conductor is unchanged
    When I correct the inline "Conductor" selection
    Then the inline "Conductor" save succeeds without navigation
    When I reload the page
    Then the inline "Conductor" selection is "srv01-bakers"

  Scenario: A denied save clears prior success and can be picked again after a reload
    When I select inline "Priority" option "High"
    Then the inline "Priority" save succeeds without navigation
    Given browser authentication is removed without reloading
    When I save denied inline "Priority" option "Low"
    Then the inline property save is rejected with HTTP 403
    And the inline "Priority" shows an unsaved error with the attempted value "Low"
    And an authenticated reload shows stored inline "Priority" option "High"
    When I reload the page
    And I select inline "Priority" option "Low"
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
    Then the inline "Labels" save succeeds without navigation
    When I select inline "Labels" option "ui"
    Then the inline "Labels" save succeeds without navigation
    When I select inline "Labels" option "bug"
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the selected inline labels are "ui, bug"
    When I select inline "Labels" option "ui"
    Then the inline "Labels" save succeeds without navigation
    When I reload the page
    Then the selected inline labels are "bug"

  Scenario: A stale form preserves another editor's property change
    Then separate stale property submissions preserve both editors changes

  Scenario: A second pick after the replacement persists without repeating an in-flight save
    Then a second pick after the replacement persists and an in-flight save is not repeated

  Scenario: A cached property form cannot be replayed to another ticket
    Then a saved property form refuses a different ticket route
