@feature:workspace-members
Feature: The workspace Members screen keeps focus and says what happened
  Invite and cancel return focus to Invite members; a refused change is
  announced and keeps focus on the refused control. Inviting and revoking
  themselves are covered by `workspace-invite.feature`.

  Scenario: Inviting returns focus to Invite members and announces the result
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the invite dialog
    And I enter two fresh, never-used e-mail addresses
    And I submit the invite dialog
    Then the invite dialog is closed
    And Invite members has focus
    And the screen reader hears "Invited 2 people."

  Scenario: Escape closes the invite dialog back to Invite members
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the invite dialog
    And I press the key "Escape"
    Then the invite dialog is closed
    And Invite members has focus

  Scenario: Removing the workspace owner is refused out loud
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I press remove for the workspace owner
    Then the screen reader hears "The owner of this workspace cannot be removed or demoted."
    And the remove control of the workspace owner has focus
    And no confirmation is open

  Scenario: A workspace guest cannot open the Members screen
    Given I am signed in as "north-guest"
    When I request the workspace Members settings screen
    Then access to the Members settings screen is denied
