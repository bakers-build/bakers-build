@work_schedule
Feature: Employees maintain one personal weekday schedule

  Scenario Outline: Saving overwrites the single schedule and keeps it private
    Given I am logged in as the account "<account>"
    When I set a personal two-hour schedule as "<account>"
    Then the personal schedule shows Monday "2:00", Tuesday "0:00" and cap ""
    When I change the personal Tuesday to "3:00" and the cap to "6:00"
    And I open the personal schedule of "<account>"
    Then the personal schedule shows Monday "2:00", Tuesday "3:00" and cap "6:00"
    When I change the personal Tuesday to "8" and the cap to "6"
    Then the personal schedule shows Monday "2:00", Tuesday "8:00" and cap "6:00"
    When I change the personal Tuesday to "3:0x" and the cap to "6:00"
    Then the personal schedule rejects the input
    Given I am logged in as the account "south-contributor"
    When I open the personal schedule of "<account>"
    Then the page is not found or forbidden

    Examples:
      | account      |
      | fixture-settings |

    @nojs
    Examples:
      | account          |
      | fixture-time-contributor |

  Scenario: Leaving a schedule field completes a bare hour
    Given I am logged in as the account "fixture-settings"
    When I open the personal schedule of "fixture-settings"
    And I type "8" into the personal Tuesday and leave it
    Then the personal Tuesday shows "8:00"
    When I type "abc" into the personal Tuesday and leave it
    Then the personal Tuesday shows "abc"
