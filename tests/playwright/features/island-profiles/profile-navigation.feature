@feature:island-profile-navigation
Feature: Changing profiles leaves a usable destination layout
  Entering a workspace changes the gate profile to the application shell.
  When the old target does not exist there, a full navigation restores the
  destination; subsequent navigation still replaces only its intended islands.

  Scenario: Entering the shell from the gate permits two consecutive island navigations
    Given I am logged in as "Administrator"
    When I open the workspace chooser route
    Then the gate chrome is present
    When I choose the workspace "/bakers/tickets"
    Then the application shell is present
    And the gate chrome is absent
    And the document was reloaded
    When I remember the shell placements
    And I click the rail entry "Projects"
    Then the document was not reloaded
    And exactly the shell placements "content,header,sidebar" were replaced in one request
    When I remember the shell placements
    And I click the rail entry "My work"
    Then the document was not reloaded
    And exactly the shell placements "content,header,sidebar" were replaced in one request
    And the address is "/bakers/tickets"

  Scenario: A placement condition shows its placement only where it passes, under one profile
    Given I am logged in as "Administrator"
    When I open the conditional placement page "first"
    Then the conditional placement is shown
    When I open the conditional placement page "second"
    Then the conditional placement is hidden
    And the menu controller shows "second"
    When I open the conditional placement page "first"
    Then the conditional placement is shown
    And the menu controller shows "first"
