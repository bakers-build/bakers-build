@feature:settings-surface
Feature: Workspace settings is the same screen by URL and by rail
  A direct visit used to pre-render the form to HTML before the shell could
  wrap it, so /settings looked different from a boosted click. Both paths
  must show the same framed surface.

  Background:
    Given I am logged in as "Administrator"

  Scenario: Opening Settings by URL frames the form
    When I visit workspace settings by URL
    Then the settings screen is framed

  Scenario: Opening Settings from the rail uses the same frame
    When I open a themed workspace screen
    And I click the rail entry "Settings"
    Then the settings screen is framed
