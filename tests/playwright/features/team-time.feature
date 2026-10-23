@time_calendar
Feature: Team leads review the time of their team

  Scenario: A team lead reviews the team week
    Given I am logged in as the account "fixture-team-lead"
    When I open the team "North Crew"
    Then the page offers the "Time" tab
    When I open the team time view of "North Crew" at "mode=week&date=2026-12-08"
    Then the time scope reads "Recorded hours of North Crew members"
    And the week total is "5:45"
    And the week strip shows "2:45" for "Tue 2026-12-08"
    And the week grid row "north-contributor" shows "1:30" on "Tue 08"
    And the week grid row "north-contributor" shows "2:00" on "Thu 10"
    And the week grid row "fixture-lead" shows "0:45" on "Tue 08"
    And the week grid row "fixture-team-lead" shows "1:00" on "Wed 09"
    And the week grid row "fixture-crew-mate" shows "0:30" on "Tue 08"
    And the week grid has no row "south-contributor"
    When I open the day "Tue 2026-12-08" in the week strip
    Then the day lists "Team member Tue"
    And the day lists "Workspace lead Tue"
    And the day lists "Crew mate home"
    And the day does not list "Crew mate other"
    And the day does not list "Foreign other"
    When I open the team time view of "North Crew" at "mode=week&date=2026-12-08"
    And I filter the time by person "north-contributor"
    Then the week total is "3:30"
    When I open the week grid cell "north-contributor" on "Thu 10"
    Then the address includes "date=2026-12-10"
    And the day lists "Team member Thu"

  Scenario Outline: Team time is denied to everyone but its leads
    Given I am logged in as the account "<account>"
    When I open the team "North Crew"
    Then the page does not offer the "Time" tab
    When I open the team time view of "North Crew" at "mode=week&date=2026-12-08"
    Then the page is not found or forbidden
    And I do not see the text "Team member Tue"

    Examples:
      | account     |
      | north-contributor  |
      | fixture-lead    |
      | south-contributor |

  Scenario: A forged person outside the team shows nothing
    Given I am logged in as the account "fixture-team-lead"
    When I open the team time view of "North Crew" for the account "south-contributor" at "mode=day&date=2026-12-08"
    Then I see the invalid period message
    And the overview total is "0:00"
    And the day does not list "Foreign other"

  Scenario: A team lead cannot edit a member's entry
    Given I am logged in as the account "fixture-team-lead"
    When I open the team time view of "North Crew" at "mode=day&date=2026-12-08"
    Then the day row "Team member Tue" has no Open link
    When I visit the time entry described as "Team member Tue"
    Then the page is not found or forbidden
    When I visit the delete form of the time entry described as "Team member Tue"
    Then the page is not found or forbidden

  Scenario: Team data is not reachable through JSON:API
    Given the API client is "north-contributor"
    When the API client reads "/jsonapi/bb_track_worklog/bb_track_worklog?filter[description]=Team lead Wed"
    Then the API response status is 200
    And the API collection is empty
    Given the API client is "fixture-team-lead"
    When the API client reads "/jsonapi/bb_track_worklog/bb_track_worklog?filter[description]=Team member Tue"
    Then the API collection contains "worklog.team-member-tue"
    When the API client reads "/jsonapi/bb_track_worklog/bb_track_worklog?filter[description]=Crew mate other"
    Then the API collection is empty
