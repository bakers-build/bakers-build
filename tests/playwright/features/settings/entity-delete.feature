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
      | project     | This action cannot be undone   |
      | team        | This action cannot be undone   |
      | group       | This action cannot be undone   |
      | environment | This action cannot be undone   |
      | label       | These will be detached from it |
      | template    | This action cannot be undone   |
      | trigger     | This action cannot be undone   |
      | ticket      | These will also be deleted     |
      | comment     | This action cannot be undone   |
      | invite      | This action cannot be undone   |

  Scenario: A project that still has tickets cannot be deleted
    Given a disposable "busy project" exists in the Northside workspace
    And I am logged in as the account "north-lead"
    When I open the Delete action of the disposable entity
    Then the delete page names "Cannot be deleted while these still use it"
    And the delete page offers no confirm button

  Scenario Outline: <account> is refused the delete page of a <kind>
    Given a disposable "<kind>" exists in the Northside workspace
    And I am logged in as the account "<account>"
    Then the delete page of the disposable entity answers 403
    And the disposable entity still exists

    Examples:
      | account     | kind        |
      | north-guest | project     |
      | north-guest | group       |
      | north-guest | environment |
      | north-guest | label       |
      | north-guest | template    |
      | north-guest | trigger     |
      | north-guest | ticket      |
      | south-lead  | project     |
      | south-lead  | team        |
      | south-lead  | label       |
      | south-lead  | invite      |
      | south-lead  | trigger     |
      | north-lead  | machine     |
      | north-lead  | conductor   |
      | north-lead  | workspace   |

  Scenario: A guest sees the team but no Delete action on it
    Given a disposable "team" exists in the Northside workspace
    And I am logged in as the account "north-guest"
    When I open the page where the disposable entity is managed
    Then the disposable entity offers no Delete action

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
      | workspace |
