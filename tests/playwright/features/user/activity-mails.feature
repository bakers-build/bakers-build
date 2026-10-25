@feature:activity-mails
Feature: Activity mails reach the accounts that opted in
  A mail goes out in the request that saves the change, right after it
  commits; there is no queue and no cron run to wait for. Only assignments
  and reviews offer a mail; the ticket event kinds offer none.

  Scenario: An account added as a reviewer gets one mail
    Given the notification settings of "north-lead" are untouched
    And a disposable ticket in state "working" is owned by "north-lead"
    And I am logged in as the account "north-lead"
    When I open the notification settings of "north-lead"
    And I tick "Review requested" under "Activity mails"
    And I save the notification settings
    And "north-lead" is added as a reviewer of the disposable ticket
    Then "north-lead" receives exactly one activity mail for the disposable ticket
    And that mail says "Your review was requested" and links to the disposable ticket

  Scenario: An account made the assignee gets one mail
    Given the notification settings of "north-lead" are untouched
    And a disposable ticket in state "working" is owned by "north-lead"
    And I am logged in as the account "north-lead"
    When I open the notification settings of "north-lead"
    And I tick "Ticket assigned" under "Activity mails"
    And I save the notification settings
    And "north-lead" is made the assignee of the disposable ticket
    Then "north-lead" receives exactly one activity mail for the disposable ticket
    And that mail says "You were assigned to this ticket" and links to the disposable ticket
