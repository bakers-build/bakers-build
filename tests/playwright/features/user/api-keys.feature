# Self-service pipeline API keys. The owner creates a key through
# the real form, the secret is shown once, the minted token carries exactly
# the owner's permissions, and revocation removes access immediately. Access
# control (owner/other/anonymous) is covered for the list and create routes.

Feature: Self-service API keys in the user area

  Background:
    Given I am logged in as the account "cwiedemann"

  Scenario: Creating a key in the dialog reveals the secret once and lists it without the secret
    When I visit my API keys page
    And I create an API key named "Pipeline" expiring in 90 days
    Then the created API key's client ID and secret are shown
    When I close the API key dialog
    Then the API key "Pipeline" is listed as active without its secret

  Scenario: A freshly created key mints a working token for the owner's workspace
    Given I have created my own API key named "CI" through the user area
    When that key's credentials are exchanged for an access token
    Then the token exchange succeeds
    And a request bearing that token can read "cwiedemann"'s own workspace
    And a request bearing that token is denied write access to a workspace "cwiedemann" is not a member of

  @nojs
  Scenario: Creating a key without JavaScript works through the full-page form
    When I visit the full-page API key creation form
    And I fill in the full-page form with name "Pipeline-nojs" expiring in 90 days
    Then the created API key's client ID and secret are shown
    When I follow the Done link
    Then the API key "Pipeline-nojs" is listed as active without its secret

  Scenario: Revoking a pipeline key removes existing access immediately
    Given I have created my own API key named "Disposable" through the user area
    And its credentials have issued an access token
    When I revoke that key through the user area
    Then that access token is rejected on the next API request
    And its client credentials cannot issue another token

  Scenario: Another authenticated user is denied and anonymous is sent to login
    When another authenticated user visits my API keys page
    Then they receive a 403
    When an anonymous visitor visits my API keys page
    Then they are redirected to the login form
