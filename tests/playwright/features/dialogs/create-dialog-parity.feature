@feature:create-dialog-parity
Feature: Create dialogs share dismissal and submission behavior
  Ticket and project dialogs close without reloading their underlying screen.
  The same document supports reopening; Escape also works before focusing the dialog.

  Background:
    Given I am logged in as "Administrator"

  Scenario Outline: A create dialog supports each dismissal method without reloading
    When I open the "<surface>" create dialog
    Then the "<surface>" create dialog offers a close control
    When I press Escape without clicking into the dialog
    Then the "<surface>" create dialog is closed
    And the document was not reloaded
    When I open the "<surface>" create dialog again
    And I close the "<surface>" create dialog by its close control
    Then the "<surface>" create dialog is closed
    And the document was not reloaded
    When I open the "<surface>" create dialog again
    And I cancel the "<surface>" create dialog
    Then the "<surface>" create dialog is closed
    And the document was not reloaded

    Examples:
      | surface |
      | ticket  |
      | project |

  Scenario Outline: A create dialog opens with focus in its first field
    When I open the "<surface>" create dialog
    Then focus is in the first field of the "<surface>" create dialog

    Examples:
      | surface |
      | ticket  |
      | project |

  # AC6's third consequence: where the action row renders, and the mechanism
  # that lets it render there at all.
  #
  # THE POSITION ALONE WOULD ASSERT NOTHING WORTH ASSERTING. The hull's footer
  # is OUTSIDE the `<form>` — the hull is the form's ancestor on both surfaces
  # now — so a submit rendered there submits nothing unless it names its form
  # owner, which is why the step also reads the `form` attribute
  # `liftActionsIntoHull()` stamps on it. That the footer submit really WRITES
  # is not re-measured here: every submitting scenario in both surfaces' own
  # feature files is now clicking this exact control and ends in a real write.
  Scenario Outline: A create dialog renders its action row in the hull's footer
    When I open the "<surface>" create dialog
    Then the "<surface>" create dialog puts its action row outside the form

    Examples:
      | surface |
      | ticket  |
      | project |

  @regression:short-viewport
  Scenario Outline: Create actions and close controls remain reachable in a short window
    When I use a short browser window
    And I open the "<surface>" create dialog
    And I close the "<surface>" create dialog by its close control
    Then the "<surface>" create dialog is closed
    When I open the "<surface>" create dialog
    And I close the "<surface>" create dialog by its close control
    Then the "<surface>" create dialog is closed

    Examples:
      | surface |
      | ticket  |
      | project |
      | group   |
      | team    |
