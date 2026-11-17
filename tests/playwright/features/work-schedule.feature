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

  # Reached through a boosted rail link, the form's action used to carry the
  # htmx request's ajax_page_state; a rejected save re-rendered there without
  # its stylesheets.
  Scenario: An invalid save after the rail link keeps the page styled
    Given I am logged in as the account "fixture-settings"
    When I visit the user area of "fixture-settings"
    And I follow "Schedule" in the user-area rail
    And I save the personal schedule with Monday "abc"
    Then the personal schedule rejects the input
    And the page is styled by the theme
