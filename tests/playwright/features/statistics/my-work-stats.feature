@feature:my-work-stats
Feature: Everyone reads their own figures on My work › Stats
  My work › Stats shows the signed-in account's own throughput, effort,
  rating and AI usage: the tickets currently assigned to it, in every
  workspace, and the runs on them. Nobody else's figures appear there.

  These scenarios check function and visibility only. Exact figures, the
  small-sample rules and the refusal of a foreign project are kernel-tested.

  Scenario: A lead reads their own figures
    Given I am logged in as the account "north-lead"
    When I visit My work tab "Insights"
    Then the page header describes the screen as "Your own figures in every workspace, always visible to you."
    And the page shows "Throughput"
    And the page shows "Runs per ticket"
    And the page shows "Rating"
    And the page shows "AI usage"
    And the page shows "New vs. done"
    And the page shows "My projects"
    And the page shows "My closed tickets"
    And the table "My closed tickets" lists the highest "AI tokens" first

  Scenario: Changing the period updates the page
    Given I am logged in as the account "north-lead"
    When I visit My work tab "Insights"
    And I choose the period kind "Year"
    Then the address carries "filter[period]=year"
    And the period compares with the previous year

  Scenario: Choosing Today and then Yesterday shows one day per hour
    Given I am logged in as the account "north-lead"
    And the fixture dates follow today
    When I visit My work tab "Insights"
    And I choose the period kind "Today"
    Then the address carries "filter[period]=day"
    And the period shows the day "Today"
    And the period compares with the day before
    And the page shows "Per hour, UTC"
    When I choose the period kind "Yesterday"
    Then the period shows the day "Yesterday"
    And the period compares with the day before

  Scenario: The project filter narrows the page to one project
    Given I am logged in as the account "north-lead"
    When I visit My work tab "Insights"
    And I open the filter "Project"
    And I tick "Statistics demo" in the filter
    Then the address carries "filter[project][]="
    And the filter "Project" reads "Statistics demo"
    And every row of the table "My projects" names "Statistics demo"

  Scenario: An abbreviated token value reveals its exact value
    Given I am logged in as the account "north-lead"
    When I visit My work tab "Insights"
    Then hovering the tile "AI usage" reveals its exact token count

  Scenario: Without a closed ticket the page explains what it counts
    Given I am logged in as the account "north-contributor"
    When I visit My work tab "Insights"
    Then the page shows "No closed tickets in"

  Scenario: An anonymous visitor is sent to the login form
    Given I am signed out
    When I visit My work tab "Insights"
    Then I am redirected to the login form
