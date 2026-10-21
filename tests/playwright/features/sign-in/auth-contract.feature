@functional @browser-contract
Feature: Authentication module request contracts
  Core forms remain reachable, destination handling survives login, and
  excluded or authenticated denials do not redirect into the login form.

  Background:
    Given the contract browser is anonymous

  Scenario: The login form exposes one address field and no credential
    When the contract browser opens "/user/login" with status 200
    Then the contract field "mail" is visible
    And the contract field "name" is absent
    And the contract field "pass" is absent

  Scenario: The old registration URL leads to the one login door
    When the contract browser opens "/user/register" with status 200
    Then the contract field "mail" is visible
    And the contract field "pass" is absent

  Scenario: Password reset is not a product door
    When the contract browser opens "/user/password" with status 200
    Then the contract field "mail" is visible
    And the contract field "name" is absent
    And the contract field "pass" is absent

  Scenario: Navigation is provided by the theme rather than the authentication module
    Given Stark presents the authentication forms
    When the contract browser opens "/user/login" with status 200
    Then the authentication module adds no theme navigation links

  Scenario: An explicit profile destination wins over the product landing
    When a recipe account signs in with its own profile as destination

  Scenario: An authenticated account without permission receives a plain denial
    Given the browser uses recipe account "stranger"
    When the contract browser opens "/admin/config" with status 403
    Then the contract browser stays on "/admin/config"

  Scenario: An excluded anonymous denial does not redirect to login
    # The exclusion is a permanent property of the e2e world (recipes/bb_e2e's
    # r4032login.settings action), not a per-scenario mutation, so this scenario
    # states the outcome directly rather than first setting up a precondition.
    # The path is /admin/reports/status, not /admin/config: login.feature's "A true
    # protected route returns through login" scenario claims /admin/config for the
    # opposite assertion (it DOES redirect), so the exclusion needs a route neither
    # scenario shares.
    When the contract browser opens "/admin/reports/status" with status 403
    Then the contract browser stays on "/admin/reports/status"
