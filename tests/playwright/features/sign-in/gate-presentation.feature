@feature:gate-presentation
Feature: Device sign-in consent and result
  An account can approve or deny the named client's request. Only an approval
  offers the route back into bakers.build.

  Scenario: An approved device code returns the account to its work
    Given the viewport is 360 pixels wide
    And I am logged in as the account "north-lead"
    And a device code was requested by the CLI
    When I open the device verification page for that code
    Then the consent names the requesting client
    When I confirm the device sign-in
    Then the address carries "done=confirmed"
    And the device result message is visible
    And the device result title is not clipped
    When I follow the result's "Go to bakers.build" action
    And I open the site root
    Then the address is "/bakers/tickets"

  Scenario: A denied device code offers no success action
    Given I am logged in as the account "north-lead"
    And a device code was requested by the CLI
    When I open the device verification page for that code
    Then the consent names the requesting client
    When I deny the device sign-in
    Then the address carries "done=denied"
    And the device result message is visible
    And the device result offers no "Go to bakers.build" action

  Scenario: A signed-out visitor signs in and returns to the device code
    Given a device code was requested by the CLI
    When I open the device verification page for that code
    Then the address is "/user/login"
    When I request an login link for "north-lead@example.test"
    And I sign in with the code from the mail
    Then the address is "/oauth/device"
    And the consent shows that device code
    And the consent names the requesting client
