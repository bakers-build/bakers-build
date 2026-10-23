Feature: Provider sign-in
  A visitor enters through a provider, and an address the provider has not
  confirmed never reaches an existing account.

  Scenario: A confirmed address lands in the existing account
    Given I open anonymous login
    When the provider returns "no-bakery@example.test" as confirmed
    Then I am logged in
    And no entities were created

  Scenario: A confirmed unknown address gets one account
    Given I open anonymous login
    When the provider returns "bakers-oauth-newcomer@example.com" as confirmed
    Then I am logged in
    And exactly one account was created
    And no workspace was created

  Scenario: An unconfirmed first sign-in is refused
    Given I open anonymous login
    When the provider returns "bakers-oauth-unconfirmed@example.com" as unconfirmed
    Then I am not logged in
    And the login error says "Google has not confirmed this address"
    And no entities were created

  Scenario: An unconfirmed address already linked to a different account is refused
    Given I open anonymous login
    When the provider returns "site-admin@example.test" as unconfirmed
    Then I am not logged in
    And the login error says "Google has not confirmed this address"
    And no entities were created

  Scenario: The provider button is on the gate
    Given I open anonymous login
    Then the gate chrome is present
    And the Google sign-in button is present
