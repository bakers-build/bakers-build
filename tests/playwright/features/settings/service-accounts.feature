# Workspace Service Accounts. A workspace administrator creates a dedicated
# automation user through the real settings tab; the secret is shown exactly
# once, a reload/second visit never recovers it, and only the workspace
# administrator may manage it — an ordinary member and a foreign-workspace
# visitor are both denied. Rotation (a second key) and Disable (the terminal
# lifecycle action) are covered end to end through the same dialogs, and the
# issued key is exercised for real: it mints a token, files a ticket authored
# by the service account, and stops working once the account is disabled.
#
# EVERY NAVIGATING SCENARIO CLICKS TWICE (suite convention): the first click
# proves the Service Accounts screen renders at all, the second proves it is a
# real, working shell rather than a page that merely rendered once.
@feature:service-accounts
Feature: Workspace service accounts settings tab

  Background:
    Given I lead a disposable service-accounts workspace

  Scenario: Creating a service account reveals its secret once and lists it without the secret
    Given I am signed in as the workspace administrator
    When I open the Service Accounts settings screen
    And I open the Service Accounts settings screen again
    And I create a service account named "incident-bot" expiring in 90 days
    Then the created service account's client ID and secret are shown
    When I close the service account dialog
    Then the service account is listed as active without its secret
    When I open the Service Accounts settings screen again
    Then the service account is listed as active without its secret

  Scenario: A rotated key keeps the same identity; revoking the old key removes only that key
    Given I am signed in as the workspace administrator
    And I have created a service account named "pipeline" through the Service Accounts screen
    When I issue a second API key for that service account
    Then the service account lists two keys
    When I revoke the first key of that service account
    Then the service account lists exactly one key

  Scenario: The issued key files a ticket authored by the service account
    Given I am signed in as the workspace administrator
    And I have created a service account named "reporter" through the Service Accounts screen
    When the service account's credentials are exchanged for an access token
    Then a ticket filed with that token in the team's project is authored by the service account and assigned to the member

  Scenario: Disabling a service account rejects its existing token and stops new ones
    Given I am signed in as the workspace administrator
    And I have created a service account named "doomed-bot" through the Service Accounts screen
    And the service account's credentials are exchanged for an access token
    When I disable that service account
    Then the service account's access token is rejected on the next API request
    And the service account's credentials cannot issue another token

  Scenario: Disabling a service account removes its key actions
    Given I am signed in as the workspace administrator
    And I have created a service account named "retiring-bot" through the Service Accounts screen
    When I disable that service account
    Then the service account is listed as disabled
    And the service account offers no Manage API keys or Disable action

  Scenario: The workspace administrator sets a service account's position and background
    Given I am signed in as the workspace administrator
    And I have created a service account named "profile-bot" through the Service Accounts screen
    When I save the service account's profile with position "Release bot" and background "Ships tagged builds"
    Then the service account is listed as active without its secret
    And the service account's profile shows position "Release bot" and background "Ships tagged builds"

  @nojs
  Scenario: Creating a service account without JavaScript works through the full-page form
    Given I am signed in as the workspace administrator
    When I create a service account named "nojs-bot" through the full-page form
    Then the service account credentials are shown on the page
    And the service account is listed as active without its secret

  Scenario: An ordinary workspace member cannot manage service accounts
    Given I am signed in as an ordinary member of that workspace
    When I request the Service Accounts settings screen
    Then access to the Service Accounts settings screen is denied

  Scenario: A member of another workspace cannot reach this workspace's Service Accounts screen
    Given I am signed in as a member of a different workspace
    When I request the Service Accounts settings screen
    Then access to the Service Accounts settings screen is denied

  Scenario: An anonymous visitor is sent to the login form
    Given I am signed out
    When I request the Service Accounts settings screen
    Then I am redirected to the login form
