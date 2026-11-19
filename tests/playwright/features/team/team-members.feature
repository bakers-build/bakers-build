@feature:team-members
Feature: Managing a team's members keeps focus and says what happened
  Every action on the team Members tab re-renders the members island only,
  puts focus where the action left the user and announces its result in the
  live region. Removing asks first, in place. Each action has a keyboard-only
  variant. `both-bakeries` is a workspace member who is not on Design Crew;
  every scenario removes them again, so the feature is re-runnable.

  Scenario: Adding a member focuses their role control and announces it
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    When I add the member "both-bakeries"
    Then the role control of the member "both-bakeries" has focus
    And the screen reader hears "Added both-bakeries as Member."
    And the add picker does not offer "both-bakeries"
    And the document was not reloaded
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"

  Scenario: Adding a member with the keyboard only
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    When I move focus to the add field
    And I press the key "Enter"
    And I type the name "both-bakeries"
    And I press the key "ArrowDown"
    And I press the key "Enter"
    And I press the key "Tab"
    And I press the key "Enter"
    Then the role control of the member "both-bakeries" has focus
    And the screen reader hears "Added both-bakeries as Member."
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"

  Scenario: Changing a role keeps focus on that member's role control
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    And I add the member "both-bakeries"
    When I pick the role "lead" for the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Lead"
    And the role control of the member "both-bakeries" has focus
    And the screen reader hears "both-bakeries is now Lead."
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"

  Scenario: Changing a role with the keyboard only
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    And I add the member "both-bakeries"
    When I move focus to the role control of the member "both-bakeries"
    And I press the key "Enter"
    And I press the key "ArrowDown"
    And I press the key "Enter"
    Then the member "both-bakeries" shows the role "Lead"
    And the role control of the member "both-bakeries" has focus
    And the screen reader hears "both-bakeries is now Lead."
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"

  Scenario: Removing asks first, and Escape cancels back to the remove control
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    And I add the member "both-bakeries"
    When I open the remove confirmation for the member "both-bakeries"
    Then a confirmation asks "Remove both-bakeries?"
    And the confirmation Cancel has focus
    When I press the key "Escape"
    Then no confirmation is open
    And the remove control of the member "both-bakeries" has focus
    And the member "both-bakeries" shows the role "Member"
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"

  Scenario: Removing a member with the keyboard only
    Given I am signed in as "north-lead"
    And the team "Design Crew" has no member "both-bakeries"
    And I visit the team "Design Crew" tab "Members"
    And I add the member "both-bakeries"
    When I move focus to the remove control of the member "both-bakeries"
    And I press the key "Enter"
    Then the confirmation Cancel has focus
    When I press the key "Tab"
    And I press the key "Enter"
    Then the members list has no member "both-bakeries"
    And focus is on a member control or the add field
    And the screen reader hears "Removed both-bakeries."
    And the document was not reloaded

  Scenario: A team lead without the workspace rank sees the roster without controls
    Given I am signed in as "fixture-team-lead"
    When I visit the team "North Crew" tab "Members"
    Then the members list offers no controls

  Scenario: A workspace guest sees the roster without controls
    Given I am signed in as "north-guest"
    When I visit the team "Platform Crew" tab "Members"
    Then the members list offers no controls
