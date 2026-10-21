@feature:island-profiles
Feature: Island profile editing preserves independently configured placements
  Apps and Profiles have separate administration. A placement keeps its identity
  and settings through adding peers, saving, reordering and changing layouts.

  Background:
    Given I am logged in as "Administrator"

  Scenario: Apps and their profiles have separate administration
    When I open Apps administration
    Then bakers.build has its own app administration
    When I open Island Profiles administration
    Then bakers.build owns multiple island profiles

  Scenario: Adding another placement preserves the first menu settings
    Given I start a disabled fixture app profile using the Shell layout
    When I add a Menu placement named "primary"
    And I configure menu placement "primary" with menu "admin", depth 2 and order 7
    And I add a Menu placement named "secondary"
    Then menu placement "primary" retains menu "admin", depth 2 and order 7
    When I configure menu placement "secondary" with menu "main", depth 1 and order -2
    And I disable placement "secondary"
    And I save and reopen the island profile
    Then exactly the placements "primary,secondary" retain their identities
    And menu placement "primary" retains menu "admin", depth 2 and order 7
    And menu placement "secondary" retains menu "main", depth 1 and order -2
    When I move placement "primary" to slot "content"
    And I configure menu placement "primary" with menu "admin", depth 2 and order -7
    And I save and reopen the island profile
    Then exactly the placements "primary,secondary" retain their identities
    And placement "primary" belongs to slot "content"
    And menu placement "primary" retains menu "admin", depth 2 and order -7
    And placement "secondary" is disabled
    When I save and reopen the island profile
    Then exactly the placements "primary,secondary" retain their identities
    And menu placement "primary" retains menu "admin", depth 2 and order -7
    And menu placement "secondary" retains menu "main", depth 1 and order -2

  Scenario: Profile and placement conditions are core condition forms that survive saving
    Given I start a disabled fixture app profile using the Shell layout
    When I add a Menu placement named "primary"
    And I configure menu placement "primary" with menu "admin", depth 2 and order 7
    And I add a Menu placement named "secondary"
    And I restrict the island profile to the pages "/pw-profile/*"
    And I hide placement "primary" on the pages "/user/*"
    And I save and reopen the island profile
    Then the island profile is restricted to the pages "/pw-profile/*"
    And placement "primary" is hidden on the pages "/user/*"
    And placement "secondary" has no page condition
    And menu placement "primary" retains menu "admin", depth 2 and order 7
    When I save and reopen the island profile
    Then the island profile is restricted to the pages "/pw-profile/*"
    And placement "primary" is hidden on the pages "/user/*"
    And placement "secondary" has no page condition
    And exactly the placements "primary,secondary" retain their identities

  Scenario: A layout change cannot silently discard an unassigned placement
    Given I start a disabled fixture app profile using the Shell layout
    When I add a Menu placement named "primary"
    And I configure menu placement "primary" with menu "admin", depth 2 and order 7
    And I save and reopen the island profile
    And I change the island profile layout to Gate
    And I attempt to save the island profile
    Then placement "primary" must be reassigned or explicitly removed
    When I reassign placement "primary" to slot "content"
    And I save and reopen the island profile
    Then exactly the placements "primary" retain their identities
    And menu placement "primary" retains menu "admin", depth 2 and order 7
    And placement "primary" belongs to slot "content"
    When I save and reopen the island profile
    Then exactly the placements "primary" retain their identities
    And menu placement "primary" retains menu "admin", depth 2 and order 7

  Scenario: Explicit removal resolves a placement that the new layout cannot host
    Given I start a disabled fixture app profile using the Shell layout
    When I add a Menu placement named "primary"
    And I configure menu placement "primary" with menu "admin", depth 2 and order 7
    And I save and reopen the island profile
    And I change the island profile layout to Gate
    And I attempt to save the island profile
    Then placement "primary" must be reassigned or explicitly removed
    When I explicitly remove placement "primary"
    And I save and reopen the island profile
    Then the island profile has no placements
    When I save and reopen the island profile
    Then the island profile has no placements
