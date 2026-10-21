@manual_worklog
Feature: Employees record and correct their own time

  Background:
    Given I am logged in as the account "cwiedemann"

  Scenario: My time offers Record time
    When I visit "/bakers/time"
    Then I see the Record time action
    When I open Record time from My time
    Then I see the time form in a dialog
    And the address includes "/bakers/time"

  Scenario: A refused entry in the My time dialog keeps the page
    Given no time entry is described as "Dialog refusal"
    When I visit "/bakers/time?mode=day&date=2026-10-13"
    And I open Record time from My time
    And I fill a time entry dated "2026-10-13" lasting "abc" on project "Time capture" described as "Dialog refusal"
    And I save the time entry
    Then the time dialog shows "Enter duration as hours:minutes, for example 0:30 or 1:15."
    And the address includes "/bakers/time"
    And I see the Record time action
    When I fill duration "0:45" and description "Dialog refusal"
    And I save the time entry
    Then the page shows "Time entry saved."
    And the overview lists "Dialog refusal"
    And the stored duration for description "Dialog refusal" is 2700 seconds

  Scenario: A valid entry in the My time dialog updates My time
    Given no time entry is described as "Dialog save"
    When I visit "/bakers/time?mode=day&date=2026-10-13"
    And I open Record time from My time
    And I fill a time entry dated "2026-10-13" lasting "0:50" on project "Time capture" described as "Dialog save"
    And I save the time entry
    Then the page shows "Time entry saved."
    And the address includes "/bakers/time"
    And I see the Record time action
    And the overview lists "Dialog save"
    And the stored duration for description "Dialog save" is 3000 seconds

  Scenario: A new entry survives save and reload
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "1:30" on project "Time capture" with ticket "Capture demo" described as "Review changes"
    And I save the time entry
    Then the time form shows date "2026-10-06" duration "1:30" project "Time capture" ticket "Capture demo" and description "Review changes"
    When I reload the page
    Then the time form shows date "2026-10-06" duration "1:30" project "Time capture" ticket "Capture demo" and description "Review changes"
    And the stored duration for description "Review changes" is 5400 seconds

  Scenario: A second tab cannot overwrite a newer save
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "1:00" on project "Time capture" described as "Stale tab original"
    And I save the time entry
    And I open the same time form in a second tab
    And I fill duration "2:00" and description "Stale tab first save"
    And I save the time entry
    And I save the time entry in the second tab
    Then the second tab shows "This entry changed. Reload it before saving."
    And the stored duration for description "Stale tab first save" is 7200 seconds

  Scenario: A second tab cannot delete after another save
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "1:00" on project "Time capture" described as "Stale delete original"
    And I save the time entry
    And I open the delete confirmation in a second tab
    And I fill duration "1:30" and description "Stale delete first save"
    And I save the time entry
    And I confirm the delete in the second tab
    Then the second tab shows "This entry changed. Reload it before saving."
    And the stored duration for description "Stale delete first save" is 5400 seconds

  Scenario: An employee edits then deletes a recorded entry
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "1:00" on project "Time capture" described as "Correction candidate"
    And I save the time entry
    And I fill duration "2:15" and description "Corrected review"
    And I save the time entry
    Then the time form shows duration "2:15" and description "Corrected review"
    When I open the delete confirmation
    And I cancel the delete
    Then the stored duration for description "Corrected review" is 8100 seconds
    When I open the delete confirmation
    And I confirm the delete
    Then the time entry described as "Corrected review" is gone
    And the time entry described as "Peer time" remains

  Scenario: Changing the project clears a ticket of the old project
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "1:00" on project "Time capture" with ticket "Capture demo" described as "Moved project"
    And I pick the project "Time capture two"
    Then the page shows "Ticket cleared: it does not belong to Time capture two."
    And the ticket picker shows no ticket
    When I save the time entry
    Then the stored ticket for description "Moved project" is empty

  Scenario: The ticket search finds tickets beyond the first fifty
    When I visit "/time/add"
    And I pick the project "Time capture"
    And I search the ticket picker for "Search target 54"
    Then the ticket picker offers "Search target 54"
    When I pick the ticket "Search target 54"
    And I fill duration "0:30" and description "Searched ticket"
    And I fill the date "2026-10-07"
    And I save the time entry
    Then the time form shows date "2026-10-07" duration "0:30" project "Time capture" ticket "Search target 54" and description "Searched ticket"

  Scenario: A double click on Save stores one entry
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-08" lasting "0:20" on project "Time capture" described as "Double click"
    And I double-click Save
    Then exactly 1 time entry described as "Double click" exists

  Scenario: A suggestion I cannot use is dropped
    When I visit Record time suggesting the project "API home" and the date "2026-10-09"
    Then the page shows "The suggested project is not available."
    And the time form shows date "2026-10-09"

  Scenario: Invalid duration is rejected on the field
    When I visit "/time/add"
    And I fill a time entry dated "2026-10-06" lasting "0:00" on project "Time capture" described as "Bad duration"
    And I save the time entry
    Then the Duration field shows an error
    And no time entry is stored with description "Bad duration"

  Scenario: A peer cannot open another employee's entry
    Given I am logged in as the account "sgruber"
    When I visit the time entry described as "Seeded proposed time"
    Then the page is not found or forbidden

  Scenario: An approved entry is read-only
    When I open the time entry described as "Seeded approved time"
    Then the page shows "Approved. This entry can no longer be changed."
    And the time form has no Save action
    And the time form has no Delete action



  @nojs
  Scenario: Time is recorded without JavaScript
    When I visit "/time/add"
    And I fill the date "2026-10-12"
    And I fill duration "1:10" and description "No script entry"
    And I choose the project "Time capture" without JavaScript
    And I choose the ticket "Search target 07" without JavaScript
    And I save the time entry
    Then the stored duration for description "No script entry" is 4200 seconds
