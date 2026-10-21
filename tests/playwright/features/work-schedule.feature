@work_schedule
Feature: Employees maintain one personal weekday schedule

  Scenario Outline: Saving overwrites the single schedule and keeps it private
    Given I am logged in as the account "<account>"
    When I set a personal two-hour schedule as "<account>"
    Then the personal schedule shows Monday "2:00", Tuesday "0:00" and cap ""
    When I change the personal Tuesday to "3:00" and the cap to "6:00"
    And I open the personal schedule of "<account>"
    Then the personal schedule shows Monday "2:00", Tuesday "3:00" and cap "6:00"
    When I change the personal Tuesday to "3:0x" and the cap to "6:00"
    Then the personal schedule rejects the input
    Given I am logged in as the account "other-member"
    When I open the personal schedule of "<account>"
    Then the page is not found or forbidden

    Examples:
      | account      |
      | api-dual-lead |

    @nojs
    Examples:
      | account          |
      | time-contributor |
