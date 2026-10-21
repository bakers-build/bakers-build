Feature: Account navigation
  Account actions remain reachable and a profile returns to its explicit workspace origin.

  Scenario Outline: Workspaces and logout remain usable in the own account rail
    Given I am logged in as the account "<account>"
    Then logout works from my account rail in "<workspace>"
    Examples:
      | account      | workspace |
      | login-multi  | bakers      |
      | other-member | other     |

  Scenario: Workspace overview belongs to workspace settings
    Given I am logged in as "Administrator"
    Then workspace settings expose the overview outside the menu

  Scenario: Profile tabs, validation and saving preserve the origin
    Given I am logged in as the account "login-multi"
    Then my profile retains the "other" origin through tabs and saving

  Scenario: Two profile tabs retain independent origins
    Given I am logged in as the account "login-multi"
    Then two profile tabs return to their own workspaces

  Scenario: Invalid and forbidden origins never invent a return destination
    Given I am logged in as the account "other-member"
    Then invalid account origins expose no workspace navigation

  Scenario: Revoked membership invalidates a cached profile origin
    Given I am logged in as the account "other-member"
    Then revoking my membership removes the cached workspace return

  Scenario: Account actions remain keyboard accessible on a narrow viewport
    Given I am logged in as the account "login-multi"
    Then account actions work with the keyboard at 320 pixels
