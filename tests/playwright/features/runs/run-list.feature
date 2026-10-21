@feature:run-list
Feature: The project and team Runs tabs list runs
  BB-482 fills the two Runs tabs — routed placeholders since BB-454 — with
  a listing View, analogous to the ticket tabs' `project_tickets`/`team_tickets`
  displays: the flat canvas, no `active-filters` wrapper, chips rendered bare
  by `views_filters_summary`. A facet pick is a boosted GET; no PHP test can
  observe whether it kept the document.

  Background:
    Given the run index is up to date

  @negative-control
  Scenario: The document detector really does see a full page load
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    And I reload the ticket list
    Then the document was reloaded

  # EVERY NAVIGATING SCENARIO PICKS MORE THAN ONCE, for the same reason the
  # ticket list's scenarios do: a boost declaration lost in a swap works
  # exactly once per page load.
  Scenario: Choosing two facets in turn keeps the document and writes the URL
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    Then the run listing is rendered inside the bakers.build shell
    And the run listing lists at least 1 run
    And the first run row carries the cells "identifier, state, state_at_start, conductor_id, agent, started_at, duration_s"
    And the first run row reads the labels "From, Started, Took"

    When I choose "Running" in the "State" facet
    Then the document was not reloaded
    And the address carries "state[]=running"
    And the "State" facet shows "Running" as chosen
    And exactly one filter chip sits above the run listing

    When I choose "Done" in the "State" facet
    Then the document was not reloaded
    And the address carries "state[]=running"
    And the address carries "state[]=done"

  Scenario: A chip is removed with a pointer, keeping the other filters
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    And I choose "Running" in the "State" facet
    And I choose "opus" in the "Agent" facet
    And I remove the "State" chip
    Then the document was not reloaded
    And the address does not carry "state[]=running"
    And the address carries "agent[]=opus"

  Scenario: The filter set survives a reload and a share
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    And I choose "Running" in the "State" facet
    And I reload the ticket list
    Then the "State" facet shows "Running" as chosen
    When I open the current address in a fresh tab
    Then the "State" facet shows "Running" as chosen

  Scenario: The team tab reads identically
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of team "Design Crew"
    Then the run listing is rendered inside the bakers.build shell
    And the first run row carries the cells "identifier, state, state_at_start, conductor_id, agent, started_at, duration_s"
    And the first run row reads the labels "From, Started, Took"

  Scenario: Every column of every row carries a value
    Given I am signed in as a member of the "bakers" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    Then no value of the run listing reads the empty-cell dash
    And the Ticket cell of the first run links to its ticket, not to the run

  # BB-490. Mirrors `ticket-list.feature`'s three closed-position scenarios
  # against the runs tab: the same `bb_closed_rows` filter and the same
  # `bb_theme:segmented_control`, on a project's run listing instead of a
  # ticket listing. `I choose the "…" closed position` and `the closed control
  # marks "…" as the current position` are `support/steps/listing.steps.ts`'s own steps,
  # reused verbatim.
  #
  # EVERY NAVIGATING SCENARIO PICKS TWICE, for the reason every one in this
  # file does: a boost declaration lost in a swap works exactly once per page
  # load.
  Scenario: The run list hides closed runs and says so
    Given I am signed in as a member of the "bakers" workspace
    And the project has an open run and a closed run
    When I visit the runs tab of project "bakers-e2e-project"
    Then the closed control marks "Open" as the current position
    And I do not see the closed run

  Scenario: The run list shows closed runs when asked
    Given I am signed in as a member of the "bakers" workspace
    And the project has an open run and a closed run
    When I visit the runs tab of project "bakers-e2e-project"
    And I choose the "All" closed position
    And I choose the "All" closed position
    Then the closed control marks "All" as the current position
    And I see the closed run

  Scenario: The run list can show closed runs alone
    Given I am signed in as a member of the "bakers" workspace
    And the project has an open run and a closed run
    When I visit the runs tab of project "bakers-e2e-project"
    And I choose the "Closed" closed position
    And I choose the "Closed" closed position
    Then the closed control marks "Closed" as the current position
    And I see the closed run
    And I do not see the open run

  Scenario: A member of another workspace is refused
    Given I am signed in as a member of the "other" workspace
    When I visit the runs tab of project "bakers-e2e-project"
    Then no run of the "bakers-e2e-project" project is listed
