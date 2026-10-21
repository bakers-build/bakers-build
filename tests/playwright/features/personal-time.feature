@time_calendar
Feature: Employees review their own time across workspaces in the account area

  Scenario: The personal view spans workspaces
    Given I am logged in as the account "api-crew-mate"
    When I open the personal time view of "api-crew-mate" at "mode=day&date=2026-12-08"
    Then the page heading is "My time"
    And the time scope reads "Your recorded hours in all workspaces"
    And the account rail marks "Time" as current
    And the day lists "Crew mate home"
    And the day lists "Crew mate other"
    And the overview total is "3:30"
    And the week strip shows "3:30" for "Tue 2026-12-08"

  Scenario: An entry on a deleted project stays in the personal view
    Given I am logged in as the account "cwiedemann"
    And the account "cwiedemann" has an entry described as "Personal deleted project hour" dated "2026-12-02" on a project that was deleted
    When I open the personal time view of "cwiedemann" at "mode=day&date=2026-12-02"
    Then the day lists "Personal deleted project hour"
    And the day lists "Unresolved project"
    When I visit "/bakers/time?mode=day&date=2026-12-02"
    Then the overview does not list "Personal deleted project hour"

  Scenario: The personal view is owner-only
    Given I am logged in as the account "api-member"
    When I open the personal time view of "api-crew-mate" at "mode=day&date=2026-12-08"
    Then the page is not found or forbidden
    And I do not see the text "Total recorded time"
    Given I open anonymous login
    When I open the personal time view of "api-crew-mate" at "mode=day&date=2026-12-08"
    Then I do not see the text "Crew mate home"
