@feature:workspace-members
Feature: The workspace Members screen keeps focus and says what happened
  Invite and cancel return focus to Invite members; a refused change is
  announced and keeps focus on the refused control. The keyboard-only invite
  and revoke live here; their full data checks are in `workspace-invite.feature`.

  Scenario: Inviting returns focus to Invite members and announces the result
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the invite dialog
    And I enter two fresh, never-used e-mail addresses
    And I submit the invite dialog
    Then the invite dialog is closed
    And Invite members has focus
    And the screen reader hears "Invited 2 people."
    And the Members screen confirms "Invited 2 people."
    And the document was not reloaded

  Scenario: Inviting and revoking with the keyboard only
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I move focus to Invite members
    And I press the key "Enter"
    Then the invite dialog is open
    And the invite addresses field has focus
    When I type two fresh, never-used e-mail addresses
    And I press the key "Enter"
    And I press the key "Tab"
    And I press the key "Tab"
    And I press the key "Tab"
    And I press the key "Tab"
    Then the invite dialog Invite has focus
    When I press the key "Enter"
    Then the invite dialog is closed
    And Invite members has focus
    And the screen reader hears "Invited 2 people."
    And the document was not reloaded
    When I move focus to the revoke of the first invited address
    And I press the key "Enter"
    Then the revoke confirmation is open
    And the revoke confirmation Cancel has focus
    When I press the key "Tab"
    Then the revoke confirmation Delete has focus
    When I press the key "Enter"
    Then the first invited address is no longer listed as a pending invitation
    And Invite members has focus
    And the screen reader hears the revoke of the first invited address
    And the document was not reloaded

  Scenario: Typed addresses become chips the keyboard can remove
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the invite dialog
    And I type "ada@example.com, not-an-address" into the invite addresses
    And I press the key "Enter"
    Then the invite addresses show the chips "ada@example.com, not-an-address"
    And the chip "not-an-address" is marked as not an e-mail address
    When I press the key "Backspace"
    Then the invite addresses show the chips "ada@example.com"
    When I remove the chip "ada@example.com"
    Then the invite addresses show no chips
    And the invite addresses field has focus

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
