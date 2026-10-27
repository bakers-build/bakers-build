@feature:workspace-insights
Feature: Workspace leads read the Insights of their workspace
  Insights is the workspace-wide statistics page. Only a lead of the
  workspace reaches it, from its own rail entry; everyone else is refused,
  and a lead of another workspace meets the workspace boundary.

  These scenarios check function and visibility only. Exact figures,
  sorting across pages and the small-sample rules are kernel-tested.

  Scenario: A workspace lead opens Insights from the rail
    Given I am logged in as the account "north-lead"
    When I open My work in workspace "bakers"
    Then the rail lists "Insights" directly before "Settings"
    When I click the rail entry "Insights"
    Then the page heading is "Insights"
    And the page header describes the screen as "Northside Bakery · all projects, all teams"
    And the page shows "Throughput"
    And the page shows "AI usage by model"
    When I click the rail entry "Projects"
    And I click the rail entry "Insights"
    Then the rail marks "Insights" as current
    And the page heading is "Insights"

  Scenario: A contributor has no Insights entry and is refused
    Given I am logged in as the account "north-contributor"
    When I open My work in workspace "bakers"
    Then the rail does not list "Insights"
    When I request the Insights of workspace "bakers"
    Then the request is answered with 403

  Scenario: The other bakery's lead meets the workspace boundary
    Given I am logged in as the account "south-lead"
    When I request the Insights of workspace "bakers"
    Then the request is answered with 404

  Scenario: Changing the period updates the page
    Given I am logged in as the account "north-lead"
    When I open the Insights of workspace "bakers"
    And I choose the period kind "Year"
    Then the address carries "filter[period]=year"
    And the period compares with the previous year

  Scenario: Sorting the projects table by a column
    Given I am logged in as the account "north-lead"
    When I open the Insights of workspace "bakers"
    And I sort the table "Projects" by "Closed"
    Then the column "Closed" of the table "Projects" is sorted "descending"
    When I sort the table "Projects" by "Closed"
    Then the column "Closed" of the table "Projects" is sorted "ascending"

  Scenario: Every tick filters at once and the popover stays open
    Given I am logged in as the account "north-lead"
    When I open the Insights of workspace "bakers"
    And I note the value of the tile "Throughput"
    And I open the filter "Project"
    And I search the filter for "Statistics"
    And I tick "Statistics demo" in the filter
    Then the address carries "filter[project][]="
    And the value of the tile "Throughput" has changed
    And the filter "Project" reads "Statistics demo"
    And the page header describes the screen as "Northside Bakery · Statistics demo"
    And the open filter still shows the search "Statistics" and its summary
    When I search the filter for "Alpha"
    And I tick "Alpha North" in the filter
    Then the page header describes the screen as "Northside Bakery · 2 projects"
    And the open filter still shows the search "Alpha" and its summary
    When I choose the period kind "Year"
    Then the page header describes the screen as "Northside Bakery · 2 projects"
    When I follow "Clear filters"
    Then the filter "Project" reads "All"
    When I go back
    Then the page header describes the screen as "Northside Bakery · 2 projects"
    And the filter "Project" reads "Alpha North"
