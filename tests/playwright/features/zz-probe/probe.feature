Feature: One-off phone probe (BAKERS-57, never committed)
  Scenario: Phone probe as lead
    Given I am signed in as "north-lead"
    When I probe the lead screens at 390 by 844 into "lead"

  Scenario: Phone probe as member
    Given I am signed in as "north-member"
    When I probe the member screens at 390 by 844 into "member"
