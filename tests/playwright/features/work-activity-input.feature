@work_activity_input
Feature: AI activity becomes recorded time without a weekly workflow

  Background:
    Given I am logged in as the account "cwiedemann"

  Scenario: Activity is recorded once and can be inspected in the ordinary form
    When I submit a two-hour activity for "2024-04-01" with source "browser-activity"
    And I repeat the last activity submission
    Then the activity response keeps the same identity and revision
    When I open the submitted activity
    Then the time form shows duration "2:00" and description "browser-activity"
    When I visit "/time/week/2024-04-01"
    Then the page is not found

  @nojs
  Scenario: Native time forms display AI bookings without a weekly confirmation
    When I set a personal two-hour schedule as "cwiedemann"
    And I submit a two-hour activity for "2024-04-08" with source "native-activity"
    And I open the submitted activity
    Then the time form shows duration "2:00" and description "native-activity"

  Scenario: Activity input cannot forge an owner or cross project visibility
    When I submit an activity with a forged owner
    Then the activity response status is 400
    Given I am logged in as the account "other-member"
    When I submit an activity for the time capture project
    Then the activity response status is 409

  Scenario: A same-workspace contributor cannot read a peer entry or configure targets
    When I submit a two-hour activity for "2024-04-15" with source "private-activity"
    Given I am logged in as the account "time-contributor"
    When I open the submitted activity
    Then the page is not found or forbidden
    When I visit "/bakers/project/612a0000-0000-4000-8000-000000000001/accounts"
    Then the page is not found or forbidden
