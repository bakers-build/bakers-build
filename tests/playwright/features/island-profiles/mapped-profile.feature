@feature:island-profile-mapping
Feature: Component mappings use current typed app data on event refresh
  Props and slot sources belong to the placement. Repeated profile instances
  have distinct app data, and only the subscribed instance is refreshed.

  @feature:island-profiles
  Scenario: Mapping controls save and reopen typed app fields and slot text
    Given I am logged in as "Administrator"
    And I start a disabled fixture app profile using the Shell layout
    When I add a component placement named "mapped"
    And I map component placement "mapped" to the app user name and body "Saved mapped body"
    Then component placement "mapped" retains the app user name mapping and body "Saved mapped body"
    When I save and reopen the island profile
    Then exactly the placements "mapped" retain their identities
    And component placement "mapped" retains the app user name mapping and body "Saved mapped body"
    When I save and reopen the island profile
    Then exactly the placements "mapped" retain their identities
    And component placement "mapped" retains the app user name mapping and body "Saved mapped body"

  Scenario Outline: The <instance> instance rereads its mapped app context twice
    Given I am logged in as "Administrator"
    And I open the mapped profile fixture
    Then both mapped instances show their own app context and configured body
    When I refresh counters in profile instance "<instance>"
    Then the document was not reloaded
    And exactly its trigger and mapped component were refreshed from current app data
    When I refresh counters in profile instance "<instance>"
    Then the document was not reloaded
    And exactly its trigger and mapped component were refreshed from current app data

    Examples:
      | instance |
      | first    |
      | second   |
