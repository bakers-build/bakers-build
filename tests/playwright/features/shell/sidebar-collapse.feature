@feature:sidebar-collapse
Feature: The navigation rail can be expanded again after it is collapsed
  Collapsing the rail used to cover the toggle with the workspace avatar, so
  a second click never landed and localStorage kept the rail stuck. The
  assertion is that the second click succeeds, not that the button exists.

  Background:
    Given I am logged in as "Administrator"

  Scenario: Collapsing the rail is reversible
    When I open a themed workspace screen with the rail expanded
    Then the rail heading "Teams" shows the "team" icon
    And I click the sidebar collapse toggle
    Then the navigation rail is collapsed
    And the workspace switcher is independently clickable
    And the collapsed rail keeps its navigation icons
    And the collapsed rail entry "My work" shows an icon
    And the rail heading "Teams" shows the "team" icon
    And the collapsed rail hides its disclosure chevrons
    When I click the sidebar collapse toggle
    Then the navigation rail is expanded

  Scenario: A destination click on the collapsed rail leaves it collapsed
    When I open a themed workspace screen with the rail expanded
    And I click the sidebar collapse toggle
    Then the navigation rail is collapsed
    When I click the collapsed rail destination "Projects"
    Then the navigation rail is collapsed
    And the page heading is "Projects"
