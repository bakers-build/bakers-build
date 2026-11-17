# A favorite belongs to one account; the scenarios mark and unmark as a fixture
# account. The rail is rendered per page load, so each check follows a reload.

Feature: Favorite projects in the navigation rail

  Background:
    Given the account "fixture-favorites" has no favorite projects
    And I am logged in as the account "fixture-favorites"

  Scenario: Mark a project, open it from the rail, unmark it
    When I visit the project "bakers.build Platform"
    Then the rail lists no favorites
    When I click the favorite toggle "Add to favorites"
    And I reload the page
    Then the page header offers "Remove from favorites"
    And the rail lists the favorite "bakers.build Platform"
    When I visit the "Projects" listing
    And I open the favorite "bakers.build Platform" from the rail
    Then the address is the detail of the project "bakers.build Platform"
    When I click the favorite toggle "Remove from favorites"
    And I reload the page
    Then the page header offers "Add to favorites"
    And the rail lists no favorites
