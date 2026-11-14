@worklog_overview
Feature: Employees review their own time in a workspace by day and week

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: My work offers My time with day and week navigation
    When I visit My work
    Then I see the My time action
    When I open My time from My work
    Then the address is "/bakers/time"
    And the My work tabs are "Tickets, My time, Stats"
    And I see the My time overview
    And the page heading is "My time"
    And the My time heading describes recorded hours
    And the period chips have no remove control
    When I choose overview mode "Day"
    And I set the overview date to "2026-11-03"
    And I apply the overview filters
    Then the address includes "mode=day"
    And the address includes "date=2026-11-03"
    And the overview total is "2:30"
    When I choose overview mode "Week"
    And I apply the overview filters
    Then the address includes "mode=week"
    And the overview total is "4:30"
    When I go to the previous overview period
    And I go to the previous overview period
    Then the address includes "date=2026-10-20"
    When I go to the next overview period
    And I go to the next overview period
    Then the address includes "date=2026-11-03"
    When I go to today's overview period
    Then the address includes "mode=week"
    When I visit "/bakers/time?mode=day&date=2026-11-03"
    Then the overview total is "2:30"

  Scenario: Day and week totals ignore a peer and the following Monday
    When I visit "/bakers/time?mode=day&date=2026-11-03"
    Then the overview total is "2:30"
    And the overview shows 3 rows
    And the overview lists "Overview A P 1:15"
    And the overview lists "Overview A Q 0:30"
    And the overview does not list "Overview B P 9:00"
    And the overview does not list "Overview A P Monday 4:00"
    When I filter the time by project "Bread · Time capture"
    Then the overview total is "2:00"
    And the overview shows 2 rows
    When I visit "/bakers/time?mode=week&date=2026-11-03"
    Then the overview total is "4:30"
    And the day column "Tue 03" header shows "2:30"
    And the day column "Sun 08" header shows "2:00"
    And the week total is "4:30"
    And the week grid row "Bread · Time capture" shows "2:00" on "Tue 03"
    And the week grid row "Bread · Time capture" shows "2:00" on "Sun 08"
    And the week grid row "Bread · Time capture two" shows "0:30" on "Tue 03"
    When I visit the overview "/bakers/time?mode=week&date=2026-11-03" for project "Time capture"
    Then the overview total is "4:00"
    And the week grid row "Bread · Time capture" shows "4:00" on "Total"
    And the week grid has no row "Bread · Time capture two"
    When I open the week grid cell "Bread · Time capture" on "Tue 03"
    Then the address includes "mode=day"
    And the address includes "date=2026-11-03"
    And the overview shows 2 rows
    When I visit "/bakers/time?mode=day&date=2026-11-09"
    Then the overview total is "4:00"
    And the overview lists "Overview A P Monday 4:00"

  Scenario: Pagination does not change the unpaged total
    Given the account "north-lead" has 26 one-minute entries dated "2026-08-18" on project "Time capture"
    When I visit "/bakers/time?mode=day&date=2026-08-18"
    Then the overview shows 25 rows
    And the overview total is "0:26"
    And the week strip shows "0:26" for "Tue 2026-08-18"
    When I open overview page 2
    Then the overview shows 1 rows
    And the overview total is "0:26"
    And the week strip shows "0:26" for "Tue 2026-08-18"
    When I visit "/bakers/time?mode=week&date=2026-07-06"
    Then the overview is empty
    And the overview total is "0:00"

  Scenario: Saving a correction returns to the filtered overview
    When I visit "/time/add"
    And I fill a time entry dated "2026-11-17" lasting "1:15" on project "Time capture" described as "Overview live correction"
    And I save the time entry
    And I visit "/bakers/time?mode=day&date=2026-11-17"
    Then the overview total is "1:15"
    When I open the overview row described as "Overview live correction"
    And I fill duration "1:00" and description "Overview live correction"
    And I save the time entry
    Then the address includes "mode=day"
    And the address includes "date=2026-11-17"
    And the overview total is "1:00"
    When I open the overview row described as "Overview live correction"
    And I fill a time entry dated "2026-11-18" lasting "1:00" on project "Time capture" described as "Overview live correction"
    And I save the time entry
    When I visit "/bakers/time?mode=day&date=2026-11-17"
    Then the overview is empty
    And the overview total is "0:00"

  Scenario: Delete cancel keeps the entry and confirm returns to the overview
    When I visit "/time/add"
    And I fill a time entry dated "2026-11-19" lasting "0:30" on project "Time capture" described as "Overview live delete"
    And I save the time entry
    And I visit "/bakers/time?mode=day&date=2026-11-19"
    Then the overview total is "0:30"
    When I open the overview row described as "Overview live delete"
    And I open the delete confirmation
    And I cancel the delete
    Then the stored duration for description "Overview live delete" is 1800 seconds
    When I open the delete confirmation
    And I confirm the delete
    Then the time entry described as "Overview live delete" is gone
    And the address includes "/bakers/time"
    And the overview total is "0:00"

  Scenario: A peer and a guest never see another employee's overview
    Given I am logged in as the account "north-member"
    When I visit "/bakers/time?mode=week&date=2026-11-03"
    Then the overview total is "9:00"
    When I visit "/bakers/time?mode=day&date=2026-11-03"
    Then the overview total is "9:00"
    And the overview lists "Overview B P 9:00"
    And the overview does not list "Overview A P 1:15"
    When I visit the time entry described as "Overview A P 1:15"
    Then the page is not found or forbidden

  Scenario: Invalid filters and calendar dates stay strict
    When I visit "/bakers/time?mode=month&date=2026-11-03"
    Then the overview is empty
    And the overview total is "0:00"
    And I see the invalid period message
    And the overview does not claim This week
    And the period chips have no remove control
    When I visit "/bakers/time?mode=day&date=2026-11-03&project=999999"
    Then the overview is empty
    And the overview total is "0:00"
    When I visit "/bakers/time?mode=week&date=2026-03-29"
    Then the overview total is "1:00"
    When I visit "/bakers/time?mode=day&date=2028-02-29"
    Then the overview total is "2:00"
    When I visit "/bakers/time?mode=week&date=2026-12-28"
    Then the overview total is "0:30"
    When I visit "/bakers/time?mode=day&date=2026-12-15"
    Then the overview total is "48:00"

  Scenario: A hostile destination does not leave the site
    When I visit "/time/add"
    And I fill a time entry dated "2026-11-20" lasting "0:15" on project "Time capture" described as "Overview hostile dest"
    And I save the time entry
    And I open the current time form with destination "https://evil.example/time"
    And I fill duration "0:20" and description "Overview hostile dest"
    And I save the time entry
    Then the address does not include "evil.example"
    And the stored duration for description "Overview hostile dest" is 1200 seconds
