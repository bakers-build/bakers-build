@feature:project-stats
Feature: Project viewers read the Stats of a project
  A project's Stats tab is the Insights page for that project: the period
  range, four tiles, New vs. done and People, filtered by epic and person.
  Every viewer of the project reaches it; an account of another workspace is
  refused.

  These scenarios check function and visibility only. Exact figures, the
  epic subtree and the filter boundary are kernel-tested.

  Scenario: A workspace lead reads the project's figures
    Given I am logged in as the account "north-lead"
    When I open the Stats of project "Statistics demo"
    Then the page shows "Throughput"
    And the page shows "Runs per ticket"
    And the page shows "Rating"
    And the page shows "AI usage"
    And the page shows "New vs. done"
    And the page shows "People"
    And the page does not show "Tickets trend"
    When I sort the table "People" by "Closed"
    Then the column "Closed" of the table "People" is sorted "descending"

  Scenario: Epic and person filters stay in the address and clear
    Given the project "Statistics demo" has the epic "Stats epic" with the closed child "Stats epic child"
    And I am logged in as the account "north-lead"
    When I open the Stats of project "Statistics demo"
    And I note the value of the tile "Throughput"
    And I open the filter "Epic"
    And I tick "Stats epic" in the filter
    Then the address carries "filter[epic][]="
    And the value of the tile "Throughput" has changed
    And the filter "Epic" reads "Stats epic"
    When I reload the page
    Then the filter "Epic" reads "Stats epic"
    When I open the filter "Person"
    And I tick "Unassigned tickets" in the filter
    Then the address carries "filter[user][]="
    When I follow "Clear filters"
    Then the filter "Epic" reads "All epics"
    And the filter "Person" reads "All"

  Scenario: A guest of the workspace reads the project's figures
    Given I am logged in as the account "north-guest"
    When I open the Stats of project "Statistics demo"
    Then the page shows "Throughput"

  Scenario: An account of the other bakery is refused
    Given I am logged in as the account "south-contributor"
    When I request the Stats of project "Statistics demo"
    Then the request is answered with 403
