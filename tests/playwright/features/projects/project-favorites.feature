# A favorite belongs to one account; the scenarios mark and unmark as a fixture
# account. A toggle announces an island event, so the rail follows without a reload.
# Favorites sit under the rail's Projects entry, each with its own Tickets.

Feature: Favorite projects in the navigation rail

  Background:
    Given the account "fixture-favorites" has no favorite projects
    And I am logged in as the account "fixture-favorites"

  Scenario: Mark a project, open it from the rail, unmark it
    When I visit the project "bakers.build Platform"
    Then the rail does not list the favorite "bakers.build Platform"
    When I click the favorite toggle "Add to favorites"
    Then the page header offers "Remove from favorites"
    And the rail lists the favorite "bakers.build Platform" under Projects
    And the rail lists the Tickets of the favorite "bakers.build Platform"
    And the rail has no Favorites section
    When I visit the "Projects" listing
    And I open the favorite "bakers.build Platform" from the rail
    Then the address is the detail of the project "bakers.build Platform"
    When I click the favorite toggle "Remove from favorites"
    Then the page header offers "Add to favorites"
    And the rail does not list the favorite "bakers.build Platform"

  Scenario: On a favorite's ticket list only its own Tickets is current
    When I visit the project "bakers.build Platform"
    And I click the favorite toggle "Add to favorites"
    And I open the Tickets of the favorite "bakers.build Platform" from the rail
    Then exactly one rail Tickets entry is current, the one of the favorite "bakers.build Platform"
    When I reload the page
    Then exactly one rail Tickets entry is current, the one of the favorite "bakers.build Platform"

  Scenario: On another project's ticket list only Projects › Tickets is current
    When I visit the ticket list of project "bakers.build Platform"
    Then the rail does not list the favorite "bakers.build Platform"
    And exactly one rail Tickets entry is current, the one under Projects

  Scenario: A favorite the user opened stays open after navigating
    Given the account "fixture-favorites" has the favorite project "bakers.build Platform"
    When I visit the "Projects" listing
    Then the rail disclosure "bakers.build Platform sub-navigation" is collapsed
    When I toggle the rail disclosure "bakers.build Platform sub-navigation"
    And I click the rail entry "My work"
    Then the rail disclosure "bakers.build Platform sub-navigation" is expanded
