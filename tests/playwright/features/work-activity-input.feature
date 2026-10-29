@work_activity_input
Feature: AI activity becomes time without a weekly workflow

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: Activity is stored once and can be inspected in the ordinary form
    When I submit a two-hour activity for "2024-04-01" with source "browser-activity"
    And I repeat the last activity submission
    Then the activity is refused with "This source was already recorded."
    When I open the submitted activity
    Then the time form shows duration "2:00" and description "browser-activity"
    When I visit "/time/week/2024-04-01"
    Then the page is not found

  @nojs
  Scenario: Native time forms display AI bookings without a weekly confirmation
    When I set a personal two-hour schedule as "north-lead"
    And I submit a two-hour activity for "2024-04-08" with source "native-activity"
    And I open the submitted activity
    Then the time form shows duration "2:00" and description "native-activity"

  Scenario: Activity input cannot forge an owner or cross project visibility
    When I submit an activity with a forged owner
    Then the activity is refused with "owner and approval fields are not accepted"
    Given I am logged in as the account "south-contributor"
    When I submit an activity for the time capture project
    Then the activity is refused with "Assignment unavailable."

  Scenario: A same-workspace contributor cannot read a peer entry or configure targets
    When I submit a two-hour activity for "2024-04-15" with source "private-activity"
    Given I am logged in as the account "fixture-time-contributor"
    When I open the submitted activity
    Then the page is not found or forbidden
    When I visit "/bakers/project/612a0000-0000-4000-8000-000000000001/accounts"
    Then the page is not found or forbidden
