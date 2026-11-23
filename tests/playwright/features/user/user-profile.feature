# Position and background, the context bakers.build hands to its AI assistants,
# have their own Profile tab, one profile per workspace; the notice that says so
# is the page's description. These scenarios save the account's profiles, so
# they run as a fixture account, a member of both bakeries.

Feature: The Profile tab edits position and background

  Background:
    Given I am logged in as the account "fixture-profile"

  Scenario: The Profile tab edits position, and Edit no longer holds the context questions
    When I visit the user area of "fixture-profile"
    And I click the tab "Profile"
    Then I am on the profile route of "fixture-profile"
    When I fill in the position "Backend engineer"
    And I save the profile form
    And I reload the page
    Then the position field holds "Backend engineer"
    When I click the tab "Edit"
    Then the edit form has no position or background field

  Scenario: The AI-use notice precedes the context questions
    When I visit the profile page of "fixture-profile"
    Then the AI-use notice is shown before the context questions

  Scenario: The context answers save and survive a reload
    Given the account "fixture-profile" has no context answers
    When I visit the profile page of "fixture-profile"
    And I answer the context questions with:
      | What should bakers.build know about your background? | Drupal developer |
    And I save the profile form
    And I reload the page
    Then the context questions hold:
      | What should bakers.build know about your background? | Drupal developer |

  Scenario: Each workspace keeps its own profile
    When I visit the profile page of "fixture-profile" in the workspace "bakers"
    And I fill in the position "North baker"
    And I save the profile form
    And I visit the profile page of "fixture-profile" in the workspace "other"
    Then the page heading is "Profile in Southside Bakery"
    When I fill in the position "South baker"
    And I save the profile form
    And I visit the profile page of "fixture-profile" in the workspace "bakers"
    Then the position field holds "North baker"
