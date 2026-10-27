@feature:workspace-billing-report
Feature: Workspace leads read the billing report of their workspace
  The Billing report tab of Insights shows hours and AI tokens per billing
  account, project and ticket, or per person. Only a lead of the workspace
  reaches it; everyone else is refused as on Overview.

  These scenarios check function and visibility only. What is counted, on
  which account, and the sums are kernel-tested.

  Scenario: A workspace lead opens the Billing report tab
    Given I am logged in as the account "north-lead"
    When I open the Insights of workspace "bakers"
    And I click the tab "Billing report"
    Then the tab "Billing report" is current
    And the page heading is "Insights"
    And the page header describes the screen as "Northside Bakery · billing report"
    And the rail marks "Insights" as current
    And the page shows "proposed time is excluded"

  Scenario: Changing the period updates the report
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    And I choose the period kind "Year"
    Then the address carries "filter[period]=year"

  Scenario: Expanding an account down to its tickets
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    Then the table "Billing report" lists the row "Time capture billing"
    When I expand the row "Statistics demo" of the table "Billing report"
    Then the row "Statistics demo" of the table "Billing report" is expanded
    When I expand the row "Statistics demo" of the table "Billing report"
    Then the table "Billing report" lists the row "STATS-1 · Statistics demo 1"

  Scenario: Grouping the report by person
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    And I follow "By person"
    Then the address carries "group=person"
    And the page shows "Person / account / project / ticket"

  Scenario: Sorting the report by hours
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    And I sort the table "Billing report" by "Hours"
    Then the column "Hours" of the table "Billing report" is sorted "descending"
    When I sort the table "Billing report" by "Hours"
    Then the column "Hours" of the table "Billing report" is sorted "ascending"

  Scenario: Filtering the report by billing account
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    And I open the filter "Account"
    And I tick "Time capture billing" in the filter
    Then the address carries "filter[account][]="
    And the filter "Account" reads "Time capture billing"

  Scenario: The report offers no export
    Given I am logged in as the account "north-lead"
    When I open the Insights page "billing" of workspace "bakers" for the period "all"
    Then the page does not show "Export"
    And the page does not show "CSV"

  Scenario: A contributor is refused
    Given I am logged in as the account "north-contributor"
    When I request the Insights page "billing" of workspace "bakers"
    Then the request is answered with 403

  Scenario: The other bakery's lead meets the workspace boundary
    Given I am logged in as the account "south-lead"
    When I request the Insights page "billing" of workspace "bakers"
    Then the request is answered with 404

  Scenario: An anonymous visitor is refused as on Overview
    Given I am signed out
    When I request the Insights page "billing" of workspace "bakers"
    Then the request is answered with 404
