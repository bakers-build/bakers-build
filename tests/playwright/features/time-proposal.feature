@time_proposal
Feature: AI proposals are reviewed before anything is booked

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: A proposal books nothing until the employee saves the week
    Given the AI proposes "1:30" on "2026-09-14" and "2:00" on "2026-09-15" for project "Time capture"
    When the AI sends the proposal again
    Then the repeated proposal is refused as already recorded
    When I open the proposal review link
    Then the week grid row "Bread · Time capture" shows "1:30" on "Mon 14"
    And the week grid row "Bread · Time capture" on "Mon 14" is marked Proposed
    And the page shows "Proposed — not yet recorded: 3:30"
    And the overview total is "0:00"
    And "north-lead" of "Time capture" on "2026-09-14" totals 0 seconds
    When I type "1:15" into the week grid row "Bread · Time capture" on "Mon 14"
    Then the week grid row "Proposed — not yet recorded" reads "1:15" on "Mon 14"
    And the week grid row "Proposed — not yet recorded" reads "3:15" on "Total"
    And "north-lead" of "Time capture" on "2026-09-14" totals 0 seconds
    When I save the week
    Then the page shows "2 proposed entries recorded"
    And the week grid row "Bread · Time capture" on "Mon 14" is not marked Proposed
    And "north-lead" of "Time capture" on "2026-09-14" totals 4500 seconds
    And "north-lead" of "Time capture" on "2026-09-15" totals 7200 seconds
    And the proposal is "draft"
    And I see the Submit action
    When I save the week
    Then "north-lead" of "Time capture" on "2026-09-14" totals 4500 seconds

  Scenario: A discarded proposal books nothing and cannot come back
    Given the AI proposes "1:00" on "2026-09-21" and "0:30" on "2026-09-22" for project "Time capture"
    When I open the proposal review link
    And I discard the proposal
    Then the proposal is "discarded"
    And no proposed entry of the proposal is left
    And "north-lead" of "Time capture" on "2026-09-21" totals 0 seconds
    When the AI sends the proposal again
    Then the repeated proposal is refused as already recorded

  Scenario: Nobody else can see or open a proposal
    Given the AI proposes "1:00" on "2026-09-28" and "0:30" on "2026-09-29" for project "Time capture"
    Given I am logged in as the account "north-member"
    When I open the proposal review link
    Then I do not see the text "Proposed"
    When I open the proposed entry dated "2026-09-28"
    Then the page is not found or forbidden

  Scenario: The submission canonical shows only entered days and saves across weeks
    Given the AI proposes "1:00" on "2027-08-02" and "0:30" on "2027-08-16" for project "Time capture"
    When I open the submission canonical
    Then the submission shows only the days "2027-08-02,2027-08-16"
    And the submission total is "1:30"
    When I change the first submission entry to "1:15" described as "Reviewed workshop"
    Then the submission total is "1:45"
    When I save the submission
    Then the page shows "2 entries recorded"
    And the proposal is "draft"
    And the submission total is "1:45"
    When I open the submission canonical
    Then the submission shows only the days "2027-08-02,2027-08-16"
    And I do not see the text "Save time"

  Scenario: Another employee cannot open a submission canonical
    Given the AI proposes "1:00" on "2026-11-23" and "0:30" on "2026-11-24" for project "Time capture"
    Given I am logged in as the account "north-member"
    When I open the submission canonical
    Then the page is not found or forbidden

  Scenario: The submission canonical discards every proposed date
    Given the AI proposes "1:00" on "2026-12-07" and "0:30" on "2026-12-21" for project "Time capture"
    When I open the submission canonical
    And I discard the proposal
    Then the proposal is "discarded"
    And no proposed entry of the proposal is left
    And the page shows "This submission has no entries."
    And I do not see the text "Save time"
    When the AI sends the proposal again
    Then the repeated proposal is refused as already recorded

  @nojs
  Scenario: Submission review works without JavaScript on a small screen
    Given I use a phone-sized screen
    And the AI proposes "1:00" on "2027-01-04" and "0:30" on "2027-01-18" for project "Time capture"
    When I open the submission canonical
    Then the submission shows only the days "2027-01-04,2027-01-18"
    And the page does not scroll sideways
    When I change the first submission entry to "0:45" described as "Reviewed without JavaScript"
    And I save the submission
    Then the page shows "2 entries recorded"
    And the proposal is "draft"
    And the submission total is "1:15"

  Scenario: A stale submission form cannot overwrite a concurrent correction
    Given the AI proposes "1:00" on "2027-02-01" and "0:30" on "2027-02-15" for project "Time capture"
    When I open the submission canonical
    And another tab changes the first submission entry to "Concurrent correction"
    And I save the submission
    Then the proposal is "proposed"
    And the page shows "An entry changed or is no longer editable. Reload the submission."
    And the first submission entry retains description "Concurrent correction"

  Scenario: A stale submission form cannot ignore a removed activity
    Given the AI proposes "1:00" on "2027-03-01" and "0:30" on "2027-03-15" for project "Time capture"
    When I open the submission canonical
    And another tab deletes the first submission entry
    And I save the submission
    Then the proposal is "proposed"
    And the page shows "The submission entries changed. Reload the submission."

  Scenario: Submission assignments follow a changed project
    Given the AI proposes "1:00" on "2027-04-05" and "0:30" on "2027-04-19" for project "Time capture"
    When I open the submission canonical
    And I open the first submission entry details
    And I pick the ticket "Capture demo"
    And I pick the project "Time capture two"
    Then the ticket picker shows no ticket
    When I pick the project "Time capture"
    And I pick the ticket "Capture demo"
    And I save the submission
    Then the proposal is "draft"
    And the first submission entry is assigned to project "Time capture" and ticket "Capture demo"

  @nojs
  Scenario: Submission assignment and ticket search work without JavaScript
    Given the AI proposes "1:00" on "2027-05-03" and "0:30" on "2027-05-17" for project "Time capture"
    When I open the submission canonical
    And I open the first submission entry details
    And I choose the first submission project "Time capture two" without JavaScript
    And I choose the first submission project "Time capture" without JavaScript
    And I choose the first submission ticket "Search target 54" without JavaScript
    And I save the submission
    Then the proposal is "draft"
    And the first submission entry is assigned to project "Time capture" and ticket "Search target 54"

  Scenario: Submission activities on the same project and day stay separate
    Given the AI proposes "1:00" on "2027-06-07" and "0:30" on "2027-06-07" for project "Time capture"
    When I open the submission canonical
    Then the submission shows only the days "2027-06-07"
    When I change the first submission entry to "1:15" described as "Separate activity"
    Then the submission total is "1:45"
    When I save the submission
    Then the page shows "2 entries recorded"
    And the proposal is "draft"
    And the first submission entry retains description "Separate activity"
    And the submission total is "1:45"

  Scenario: Invalid submission duration keeps the edited values without recording
    Given the AI proposes "1:00" on "2027-07-05" and "0:30" on "2027-07-19" for project "Time capture"
    When I open the submission canonical
    And I change the first submission entry to "25:61" described as "Keep this correction"
    And I save the submission
    Then the proposal is "proposed"
    And the page shows "Enter duration as hours:minutes, for example 0:30 or 1:15."
    And the first submission duration is "25:61"
    When I change the first submission entry to "1:15" described as "Keep this correction"
    And I save the submission
    Then the proposal is "draft"
    And the submission total is "1:45"
