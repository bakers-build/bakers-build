@time_calendar
Feature: The project time view narrows each viewer's own authorized time

  Scenario: A team lead sees the team's hours on the project, a member only their own
    Given I am logged in as the account "fixture-team-lead"
    When I open the project "API home"
    Then the page offers the "Time" tab
    When I open the project time view of "API home" at "mode=week&date=2026-12-08"
    Then the time scope reads "Recorded hours on API home"
    And the week total is "3:45"
    And the day column "Tue 08" header shows "2:45"
    And the week grid row "north-contributor" shows "1:30" on "Tue 08"
    And the week grid row "fixture-crew-mate" shows "0:30" on "Tue 08"
    Given I am logged in as the account "north-contributor"
    When I open the project time view of "API home" at "mode=week&date=2026-12-08"
    Then the week total is "1:30"
    And the time view offers no person filter
    When I open the project time view of "API home" at "mode=day&date=2026-12-08&person=999999"
    Then I see the invalid period message
    And the overview total is "0:00"

  Scenario: Record time from a project view returns to it
    Given I am logged in as the account "north-lead"
    When I open the project time view of "Time capture" at "mode=day&date=2026-11-24"
    Then Record time carries "project" as "Time capture"
    And Record time carries "date" as "2026-11-24"
    And Record time returns to this time view
    When I follow Record time as a page
    And I fill a time entry dated "2026-11-24" lasting "0:45" on project "Time capture" described as "Project view round trip"
    And I save the time entry
    Then the address includes "/project/"
    And the address includes "date=2026-11-24"
    And the overview total is "0:45"
    When I open the overview row described as "Project view round trip"
    And I fill duration "1:15" and description "Project view round trip"
    And I save the time entry
    Then the address includes "/project/"
    And the overview total is "1:15"
    When I open the overview row described as "Project view round trip"
    And I open the delete confirmation
    And I confirm the delete
    Then the time entry described as "Project view round trip" is gone
    And the address includes "/project/"
    And the overview total is "0:00"
