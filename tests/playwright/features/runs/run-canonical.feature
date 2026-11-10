@feature:run-canonical
Feature: A run has a ticket-relative canonical page
  The run page lives at /{workspace}/ticket/{ticket}/run/{run} inside the
  workspace shell. Breadcrumb is Workspace → Ticket → Run. Logs are
  download-only. The old un-nested /{workspace}/run/{id} address is gone.

  Background:
    Given I am signed in as a member of the "bakers" workspace

  Scenario: The run page is a canvas inside the shell, with a breadcrumb
    When I visit the seeded run "dbb00000-0000-4000-8000-000000000001"
    Then the application shell is present
    And the page heading is the run title
    And a breadcrumb trail is present
    And exactly one canvas is present in the document
    And the canvas has a main region
    And the canvas has an inspector region
    And the inspector region holds exactly one inspector
    And the page shows "Latest ticket summary"
    And the page shows "Activity"
    And the canonical run page has no inline log viewer

  Scenario: The old un-nested run address is gone
    When I open the un-nested address of the seeded run "dbb00000-0000-4000-8000-000000000001"
    Then the run page response status is 404

  Scenario: A run under the wrong ticket is not found
    When I visit the seeded run "dbb00000-0000-4000-8000-000000000001" under a different ticket
    Then the run page response status is 404

  Scenario: Opening a run from the ticket history lands on the canonical page
    Given a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable ticket
    And I open the disposable run from its history row
    Then the page heading is the disposable run title
    When I go back
    And I open the disposable run from its history row
    Then the page heading is the disposable run title
    And the document was not reloaded

  Scenario: The ticket crumb returns to the ticket
    Given a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable ticket
    And I open the disposable run from its history row
    And I follow the ticket crumb in the breadcrumb
    Then the page heading is the disposable ticket title
    When I go back
    And I follow the ticket crumb in the breadcrumb
    Then the page heading is the disposable ticket title
    And the document was not reloaded

  Scenario: Cancel run is offered only while the run is eligible
    Given I am logged in as "Administrator"
    And a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable run page
    Then the run page offers "Cancel run"
    When I visit the seeded run "dbb00000-0000-4000-8000-000000000001"
    Then the run page offers no "Cancel run"

  Scenario: A failed run explains itself and offers its actions
    Given I am logged in as "Administrator"
    And a disposable "bb_work" ticket in state "working" whose last 3 runs failed with "plugins: claude install failed: 401"
    When I visit the disposable run page
    Then the page says "plugins: claude install failed: 401"
    And the run page offers "Retry"
    And the run page offers "Re-dispatch"
    And the run page offers "Log"
    And the run page offers no "Cancel run"
    Given I am signed in as "north-guest"
    When I visit the disposable ticket
    Then the page heading is the disposable ticket title
    And the ticket page offers no intervention
