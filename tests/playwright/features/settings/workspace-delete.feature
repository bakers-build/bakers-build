@functional @feature:workspace-delete
Feature: Deleting a workspace from its Settings
  The owner of a workspace deletes it from a danger zone on Settings by typing
  its slug. The first team, memberships and workspace config go with it; a
  group or project still blocks. Other leads and members see no action and get
  403 on the delete page; a site administrator deletes the same way.

  Scenario: The owner deletes a freshly provisioned workspace
    Given a disposable "owned workspace" exists
    And I am logged in as the account "fixture-workspace-owner"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers the Delete action "Delete workspace"
    When I open the Delete action of the disposable entity
    Then the delete page names "This also deletes"
    When I type "not-the-slug" to confirm
    And I submit the deletion
    Then the delete page names "The slug does not match"
    And the disposable entity still exists
    When I type the slug of the disposable workspace to confirm
    And I confirm the deletion
    Then I land on the workspace overview
    And the page confirms the disposable entity was deleted
    And the disposable entity no longer exists
    And the entities the disposable entity needed no longer exist

  Scenario: The owner deletes the workspace in the dialog over Settings
    Given a disposable "owned workspace" exists
    And I am logged in as the account "fixture-workspace-owner"
    When I open the page where the disposable entity is managed
    And I open the Delete dialog of the disposable entity
    Then the delete dialog names "Type the workspace slug"
    When I type "not-the-slug" to confirm
    And I submit the deletion
    Then the delete dialog names "The slug does not match"
    When I type the slug of the disposable workspace to confirm
    And I confirm the deletion in the dialog
    Then I land on the workspace overview
    And the disposable entity no longer exists

  Scenario: A group keeps the owner from deleting the workspace
    Given a disposable "owned workspace with a group" exists
    And I am logged in as the account "fixture-workspace-owner"
    When I open the Delete action of the disposable entity
    Then the delete page names "can't be deleted"
    And the delete page offers no confirm button
    And the delete page asks for no slug

  Scenario Outline: <account>, not the owner, gets no Delete workspace
    Given I am logged in as the account "<account>"
    Then the Settings page of the workspace "bakers" offers no Delete workspace
    And the delete page of the workspace "bakers" answers 403

    Examples:
      | account      |
      | north-lead   |
      | north-member |

  Scenario: A site administrator deletes a workspace after typing its slug
    Given a disposable "owned workspace" exists
    And I am logged in as the account "site-admin"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers its Delete action
    When I open the Delete action of the disposable entity
    And I type the slug of the disposable workspace to confirm
    And I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists

  Scenario: The owner deletes a group someone else created in the workspace
    Given a disposable "group in an owned workspace" exists
    And I am logged in as the account "fixture-workspace-owner"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers its Delete action
    When I open the Delete action of the disposable entity
    And I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists
