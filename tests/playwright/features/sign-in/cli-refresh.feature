@feature:cli-refresh @cli-refresh
Feature: CLI device sessions can refresh
  The CLI signs in through the device grant and renews that sign-in with the
  rotating refresh token. Several CLI processes share one stored session, so
  a process still holding the rotated-out token must adopt the renewed one
  instead of ending in credentials_rejected. Driven through the real CLI
  connection code in separate processes against this site's token endpoint;
  the browser only approves the device code.

  Scenario: Two CLI processes keep the signed-in user's session after rotation
    Given I am logged in as the account "north-lead"
    And a CLI device sign-in is waiting for this test site
    When I approve that CLI device sign-in
    And two persistent CLI clients load its saved session
    And the first client renews the session
    And the second client renews its original in-memory session
    Then both clients can read the same permitted workspaces
    And the refreshed access token keeps the user "north-lead" and the bb:session scope
    And the original refresh token is rejected when replayed
