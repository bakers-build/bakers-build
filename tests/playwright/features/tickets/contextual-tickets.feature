@feature:contextual-tickets
Feature: Contextual tickets keep route and filter state
  Background:
    Given the ticket index is up to date
    And I am signed in as a member of the "bakers" workspace

  # BB-462 D7/D8: the project screen's Members tab is retired along with
  # project membership itself — Tickets is its one remaining face, and
  # `BbProjectRouteProvider` (F11) now redirects the canonical route
  # straight there. The "click twice" convention this used to demonstrate
  # on Members/Tickets has nothing left to click BETWEEN on this screen; the
  # team scenario below still exercises it on a screen that still has two
  # faces.
  # The project is the route context, and Group and Team are indexed from
  # that same project, so none of the three can tell its tickets apart.
  Scenario: Project tickets offer only filters that distinguish the project's tickets
    Given a dedicated project "Contextual filters" has 3 open tickets
    When I visit the contextual tickets for the project "Contextual filters"
    Then the filters read "Closed, State, Parent, Workflow, Assignee, Created by, Priority, Labels" in order
    When I note the listed tickets
    And I reopen the address with the removed keys "group[]=999999&team[]=999999&project[]=999999"
    Then the listed tickets are unchanged
    And no active filter names "Group, Team, Project"
    And the contextual ticket route is unchanged

  Scenario: Project filters reset paging and survive reload and sharing
    When I visit the contextual tickets for the project "bakers.build Platform"
    Then the application shell is present
    When I open the next contextual ticket page
    Then the address carries "page=1"
    When I choose "Working" in the "State" facet
    Then the address does not carry "page="
    And the "State" facet shows "Working" as chosen
    And the contextual ticket route is unchanged
    When I remove the "State" chip
    And I choose "Plan" in the "State" facet
    And I reload the ticket list
    Then the "State" facet shows "Plan" as chosen
    And the contextual ticket route is unchanged
    When I open the current address in a fresh tab
    Then the "State" facet shows "Plan" as chosen
    When I open a contextual filter with no matches
    Then the contextual no-match message is visible

  Scenario: Team filters survive two tab clicks, reload and sharing
    When I visit the team "Platform Crew" tab "Tickets"
    And I click the tab "Members"
    And I click the tab "Tickets"
    Then the application shell is present
    And the filters read "Closed, Group, Project, Template, State, Parent, Workflow, Assignee, Created by, Priority, Labels" in order
    When I choose "Working" in the "State" facet
    Then the "State" facet shows "Working" as chosen
    When I remove the "State" chip
    And I choose "Plan" in the "State" facet
    And I reload the ticket list
    Then the "State" facet shows "Plan" as chosen
    When I open the current address in a fresh tab
    Then the "State" facet shows "Plan" as chosen
    When I open a contextual filter with no matches
    Then the contextual no-match message is visible

  Scenario: A shared project URL remains inaccessible to another workspace
    When I visit the contextual tickets for the project "bakers.build Platform"
    Then the ticket listing is rendered inside the bakers.build shell
    Given I am signed in as a member of the "other" workspace
    When I visit the contextual tickets for the project "bakers.build Platform"
    Then the contextual ticket page denies access
    And no ticket of the "bakers" workspace is listed
