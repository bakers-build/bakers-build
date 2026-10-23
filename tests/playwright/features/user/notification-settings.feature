@feature:notification-settings
Feature: Each account chooses which ticket activities reach it by email
  The settings live in the user area next to Time and Schedule. "Activity
  mails" offers one checkbox per activity kind that can be mailed: tickets
  assigned to the account, reviews it is asked for and reviews it asked for.

  Scenario: The Notifications entry sits in my user area after Schedule
    Given I am logged in as the account "fixture-settings"
    When I visit the user area of "fixture-settings"
    And I follow "Notifications" in the user-area rail
    And I follow "Notifications" in the user-area rail
    Then the user-area rail lists "Notifications" directly after "Schedule"
    And the user-area rail marks "Notifications" as the current entry
    And the notification settings form is inside the app shell

  Scenario Outline: Saved choices survive a reload
    Given the notification settings of "<account>" are untouched
    And I am logged in as the account "<account>"
    When I open the notification settings of "<account>"
    And I tick "Ticket assigned" under "Activity mails"
    And I tick "Review requested" under "Activity mails"
    And I save the notification settings
    Then the notification settings confirm the save
    When I open the notification settings of "<account>"
    Then "Ticket assigned" is ticked under "Activity mails"
    And "Review requested" is ticked under "Activity mails"
    And "Review completed" is not ticked under "Activity mails"

    Examples:
      | account       |
      | fixture-settings |

    @nojs
    Examples:
      | account          |
      | fixture-time-contributor |

  Scenario: The mailed kinds are offered in one group
    Given I am logged in as the account "fixture-settings"
    When I open the notification settings of "fixture-settings"
    Then the notification settings offer "Activity mails"
    And the notification settings do not offer "My tickets"

  Scenario: Another member cannot open my notification settings
    Given I am logged in as the account "south-contributor"
    When I open the notification settings of "fixture-settings"
    Then the page is not found or forbidden

  Scenario: An administrator can open another account's notification settings
    Given I am logged in as the account "site-admin"
    When I open the notification settings of "fixture-settings"
    Then the notification settings form is inside the app shell
