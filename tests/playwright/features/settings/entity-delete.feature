@functional @feature:entity-delete
Feature: Deleting an entity where it is managed
  Every deletable entity offers a Delete action where it is managed, only to
  who may delete it. Delete asks for confirmation, names what goes with it or
  is detached, refuses while something still uses it, and lands back on the
  owning page. Denied accounts see no action and get 403 on the delete page.
  Each scenario deletes an entity it created itself.

  Scenario Outline: A workspace lead deletes a <kind> after confirming
    Given a disposable "<kind>" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers its Delete action
    When I open the Delete action of the disposable entity
    Then the delete page is titled after the disposable entity
    And the delete page names "<named>"
    When I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists

    Examples:
      | kind        | named                          |
      | team        | This action cannot be undone   |
      | environment | This action cannot be undone   |
      | label       | will be detached from it       |
      | template    | This action cannot be undone   |
      | trigger     | This action cannot be undone   |
      | ticket      | This also deletes              |
      | comment     | This action cannot be undone   |
      | invite      | This action cannot be undone   |

  Scenario Outline: Its creator deletes a <kind> after confirming
    Given a disposable "<kind>" created by "north-lead" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers its Delete action
    When I open the Delete action of the disposable entity
    Then the delete page is titled after the disposable entity
    When I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists

    Examples:
      | kind    |
      | project |
      | group   |

  Scenario: A project that still has tickets cannot be deleted
    Given a disposable "busy project" created by "north-lead" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the Delete action of the disposable entity
    Then the delete page names "can't be deleted"
    And the delete page offers no confirm button

  Scenario: A project's conductor is deleted with the project
    Given a disposable "conductor project" created by "north-lead" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the Delete action of the disposable entity
    Then the delete page names "This also deletes"
    When I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists
    And the entities the disposable entity needed no longer exist

  Scenario Outline: <account> is refused the delete page of a <kind>
    Given a disposable "<kind>" exists in the Northside workspace
    And I am logged in as the account "<account>"
    Then the delete page of the disposable entity answers 403
    And the disposable entity still exists

    Examples:
      | account      | kind        |
      | north-guest  | project     |
      | north-guest  | group       |
      | north-guest  | environment |
      | north-guest  | label       |
      | north-guest  | template    |
      | north-guest  | trigger     |
      | north-guest  | ticket      |
      | north-lead   | project     |
      | north-lead   | group       |
      | north-member | project     |
      | north-member | group       |
      | south-lead   | project     |
      | south-lead   | team        |
      | south-lead   | label       |
      | south-lead   | invite      |
      | south-lead   | trigger     |
      | north-lead   | machine     |
      | north-lead   | conductor   |
      | north-lead   | workspace   |

  Scenario: A guest gets neither the team Settings nor its Delete
    Given a disposable "team" exists in the Northside workspace
    And I am logged in as the account "north-guest"
    Then the page where the disposable entity is managed answers 403
    And the delete page of the disposable entity answers 403

  Scenario Outline: A site administrator deletes a <kind> after confirming
    Given a disposable "<kind>" exists in the Northside workspace
    And I am logged in as the account "site-admin"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers its Delete action
    When I open the Delete action of the disposable entity
    And I confirm the deletion
    Then the page confirms the disposable entity was deleted
    And the disposable entity no longer exists

    Examples:
      | kind      |
      | machine   |
      | conductor |
