# The workspace Members settings screen invites through its dialog, opened by
# the Members zone's "Invite members" action: an e-mail textarea taking one or
# more addresses, and below it the Workspace role and Team pills.
# `invitation.feature` starts from a seeded invite; this feature is the other
# half — that the real dialog is what creates one.
#
# EVERY NAVIGATING SCENARIO CLICKS TWICE (suite convention): the first click
# proves the Members screen renders at all, the second proves it is a real,
# working shell rather than a page that merely rendered once.
Feature: Inviting workspace members from the Members settings screen

  Scenario: A workspace lead invites two addresses with a role and a team, and can still revoke one
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the workspace Members settings screen again
    And I open the invite dialog
    Then the invite dialog opens on the workspace role "Contributor" and the team "Automation Crew"
    And the workspace role "Admin" is explained as "Manages members and sees every project."
    When I enter two fresh, never-used e-mail addresses
    And I pick the workspace role "Admin"
    And I submit the invite dialog
    Then the invite dialog is closed
    And the Members screen confirms "Invited 2 people."
    And each invited address is listed as pending with the role "Admin" and the team "Automation Crew"
    And exactly one invitation mail reaches each invited address
    When I revoke the pending invitation of the first invited address
    Then the first invited address is no longer listed as a pending invitation

  Scenario: A workspace member who does not lead it cannot open the Members settings screen
    Given I am signed in as a workspace member who does not lead it
    When I request the workspace Members settings screen
    Then access to the Members settings screen is denied

  # An existing member is skipped, and with nobody left to invite the submit
  # is refused on the address field; the dialog keeps what was typed.
  Scenario: Inviting only an existing member is refused in the dialog
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the workspace Members settings screen again
    And I open the invite dialog
    And I enter the address of an existing member
    And I submit the invite dialog
    Then the invite dialog marks the addresses as refused and keeps them
    And the existing member's address is not listed as a pending invitation
    And no invitation mail reaches the existing member

  # A typo is fixed, not dropped: one malformed entry refuses everything.
  Scenario: A malformed entry refuses the whole submit
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the workspace Members settings screen again
    And I open the invite dialog
    And I enter a fresh address and the entry "not-an-address"
    And I submit the invite dialog
    Then the invite dialog names "not-an-address" as not an e-mail address
    And the invite dialog marks the addresses as refused and keeps them
    And no invitation exists for that address
    And no invitation mail reaches that address

  # A role the picker does not offer, posted anyway. The server refuses it on
  # the field, writes no invitation and sends no mail.
  Scenario: A forged workspace role is refused
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the workspace Members settings screen again
    And I open the invite dialog
    And I enter one fresh, never-used e-mail address
    And I forge the workspace role "bb_workspace-bb_workspace-non-member"
    And I submit the invite dialog
    Then the invite dialog refuses the workspace role
    And no invitation exists for that address
    And no invitation mail reaches that address

  Scenario: Cancelling the invite dialog keeps the Members screen
    Given I am signed in as a workspace lead
    When I open the workspace Members settings screen
    And I open the workspace Members settings screen again
    And I open the invite dialog
    And I cancel the invite dialog
    Then the invite dialog is closed
    And the Members screen still lists its members

  # JSON:API runs the same rule as the dialog: a lead of this workspace cannot
  # attach a team of another one.
  Scenario: The invitation API refuses a team of another workspace
    Given the API client is "fixture-lead"
    When the API client sends "POST" to "/jsonapi/bb_invite/bb_invite":
      """
      {"data":{"type":"bb_invite--bb_invite","attributes":{"email":"api-foreign-team@example.com"},"relationships":{"workspace_id":{"data":{"type":"bb_workspace--bb_workspace","id":"{workspace.home}"}},"team_id":{"data":{"type":"bb_team--bb_team","id":"{team.other}"}}}}}
      """
    Then the API response status is 422
    And the API error mentions "Choose a team of"
