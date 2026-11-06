@functional @feature:delete-dialog
Feature: Delete opens its confirmation as a dialog over the page
  Every Delete action opens its confirm form as the dialog in the shell's
  overlay, over the page it was clicked on. Cancel, the close control and
  Escape close it without leaving the page; confirming deletes and lands where
  the delete always lands. A delete that something still blocks names the
  blockers and offers only Close. Opening the delete page directly, and the
  denials, are covered by entity-delete.feature.

  Scenario: A workspace lead opens and dismisses the delete dialog of a ticket
    Given a disposable "ticket" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the page where the disposable entity is managed
    And I open the Delete dialog of the disposable entity
    Then the delete dialog is titled after the disposable entity
    And the delete dialog names "This also deletes"
    And the address is still the page the dialog was opened over
    When I press Escape without clicking into the dialog
    Then the delete dialog is closed
    And the document was not reloaded
    When I open the Delete dialog of the disposable entity
    And I close the delete dialog by its close control
    Then the delete dialog is closed
    And the document was not reloaded
    When I open the Delete dialog of the disposable entity
    And I cancel the delete dialog
    Then the delete dialog is closed
    And the document was not reloaded
    And the disposable entity still exists

  Scenario: A workspace lead deletes a ticket in the dialog
    Given a disposable "ticket" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the page where the disposable entity is managed
    And I open the Delete dialog of the disposable entity
    And I confirm the deletion in the dialog
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists

  Scenario: A project that still has tickets names them and offers only Close
    Given a disposable "busy project" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the page where the disposable entity is managed
    And I open the Delete dialog of the disposable entity
    Then the delete dialog names "can't be deleted: 1 bakers.build ticket still uses it"
    And the delete dialog links the blocking ticket
    And the delete dialog offers only Close
    When I cancel the delete dialog
    Then the delete dialog is closed
    And the disposable entity still exists

  Scenario: A site administrator deletes a machine in the dialog inside the shell
    Given a disposable "machine" exists in the Northside workspace
    And I am logged in as the account "site-admin"
    When I open the page where the disposable entity is managed
    And I open the Delete dialog of the disposable entity
    Then the delete dialog is titled after the disposable entity
    When I confirm the deletion in the dialog
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists
