@week_sheet
Feature: Employees record their week in an editable grid

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: Hours typed into the week are saved together
    When I visit "/bakers/time?mode=week&date=2026-09-07"
    Then the week grid row "Bread · Time capture" on "Mon 07" is locked
    When I type "0:45" into the week grid row "Bread · Time capture" on "Tue 08"
    And I save the week
    Then the page shows "Week saved: 1 change, 0 proposed entries recorded."
    And the week grid row "Bread · Time capture" shows "0:45" on "Tue 08"
    And "north-lead" of "Time capture" on "2026-09-08" totals 2700 seconds
    When I reload the page
    Then the week grid row "Bread · Time capture" shows "0:45" on "Tue 08"

  Scenario: An invalid cell saves nothing and keeps every typed value
    When I visit "/bakers/time?mode=week&date=2026-09-07"
    And I type "25:61" into the week grid row "Bread · Time capture" on "Wed 09"
    And I type "0:30" into the week grid row "Bread · Time capture" on "Thu 10"
    And I save the week
    Then the week grid row "Bread · Time capture" on "Wed 09" shows the error "Enter duration as hours:minutes, for example 0:30 or 1:15."
    And the week grid row "Bread · Time capture" shows "0:30" on "Thu 10"
    And "north-lead" of "Time capture" on "2026-09-10" totals 0 seconds

  Scenario: Details opens the entry in a dialog and the week follows the save
    Given "north-lead" recorded "1:00" on "2026-10-20" for project "Time capture" described as "Dialog details"
    When I visit "/bakers/time?mode=week&date=2026-10-19"
    And I open the details of the week grid row "Bread · Time capture" on "Tue 20"
    Then the time dialog leads with "Tue 20 Oct · Bread · Time capture"
    And the time dialog marks the entry "Recorded"
    When I fill duration "1:45" and description "Dialog details"
    And I save the time entry
    Then the week grid row "Bread · Time capture" shows "1:45" on "Tue 20"
    And the address still shows the week of "2026-10-19"
    And the stored duration for description "Dialog details" is 6300 seconds

  Scenario: Add row opens a dialog and the chosen row joins the grid
    When I visit "/bakers/time?mode=week&date=2026-10-26"
    And I add the week row for project "Time capture two" in the dialog
    Then the week grid has a row "Bread · Time capture two"
    When I type "0:30" into the week grid row "Bread · Time capture two" on "Wed 28"
    And I save the week
    Then "north-lead" of "Time capture two" on "2026-10-28" totals 1800 seconds
    When I add the week row for project "Time capture" and ticket "Capture demo" in the dialog
    Then the week grid has a row ending in "Capture demo"

  Scenario: A day opened from a locked cell can drop its filters
    When I visit "/bakers/time?mode=week&date=2026-09-07"
    And I follow the locked cell of the week grid row "Bread · Time capture" on "Mon 07"
    Then the address filters by project
    When I clear the filters
    Then the address keeps the day "2026-09-07" without filters

  Scenario: Record time and the week work with the keyboard on a phone
    Given I use a phone-sized screen
    When I visit "/time/add"
    And I record with the keyboard only "0:40" on project "Time capture" dated "2027-01-12" described as "Keyboard entry"
    Then the stored duration for description "Keyboard entry" is 2400 seconds
    And the time entry described as "Keyboard entry" is dated "2027-01-12"
    And the page does not scroll sideways
    When I visit "/time/add"
    And I record with the keyboard only "0:00" on project "Time capture" dated "2027-01-12" described as "Keyboard refused"
    Then the focus is on the "Duration (hours:minutes)" field and its error is announced
    And no time entry is stored with description "Keyboard refused"
    When I visit "/bakers/time?mode=week&date=2027-01-11"
    And I type "0:15" with the keyboard into the week grid row "Bread · Time capture" on "Wed 13" and save the week with Enter
    Then "north-lead" of "Time capture" on "2027-01-13" totals 900 seconds
    And the page does not scroll sideways
