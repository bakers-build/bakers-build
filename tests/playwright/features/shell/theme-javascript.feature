@feature:theme-javascript
Feature: The theme's JavaScript bundle loads without collateral damage
  The theme gained a bundled Alpine entry point, and one of the defects that
  shipped with it was invisible to every other gate: a Storybook build
  compiles the stories, a contract script reads files, and a PHP test never
  executes a script tag. That defect was a global-scope accident a page
  reports once, loudly, and then carries silently.

  A second defect this feature used to guard — Alpine's minified `_(t){…}`
  helper replacing core's Underscore, breaking `core/modules/toolbar`'s
  Backbone views — is retired along with `toolbar` itself (BB-683):
  nothing in the product loads Underscore any more, so there is no global to
  collide with.

  Background:
    Given I am logged in as "Administrator"

  Scenario: A workspace screen loads the theme without errors or global collisions
    When I open a themed workspace screen
    Then the page raised no JavaScript errors
    And the theme's bundle is loaded as a module
