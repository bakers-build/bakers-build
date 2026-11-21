@feature:rail-disclosure
Feature: The navigation rail keeps the disclosure state the user chose
  htmx boost swaps the whole rail on every navigation, so a group the user
  opened or collapsed used to fall back to the server default on the next
  page. The state the user chose holds until they toggle it again.

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: A team row is a plain link without a sub-navigation
    When I open a themed workspace screen
    Then the rail team "Automation Crew" links to the team and has no sub-navigation

  Scenario: The Teams heading the user collapsed stays collapsed after navigating
    When I open a themed workspace screen
    And I toggle the rail disclosure "Teams"
    Then the rail disclosure "Teams" is collapsed
    When I click the rail entry "My work"
    Then the rail disclosure "Teams" is collapsed
