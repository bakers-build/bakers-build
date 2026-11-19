@feature:ticket-interventions
Feature: A person restarts a ticket's runs from its page
  A person who may update the ticket restarts it from the Properties footer
  while its newest run is claimed, running or failed, parked or not: Restart
  runs names the runs, OK cancels them so the ticket gets one fresh run, and
  Cancel closes without a change. Every run stays in its history. A guest who
  may only view the ticket gets no Restart runs. Every scenario works on its
  own disposable ticket so the seeded fixtures stay untouched.

  Scenario: A lead restarts a ticket whose newest run failed
    Given I am signed in as "north-lead"
    And a disposable "bb_work" ticket in state "working" whose last 1 runs failed with "ddev start failed"
    When I visit the disposable ticket
    Then the ticket page offers "Restart runs"
    And the ticket page does not offer "Restart ticket"
    When I open "Restart runs"
    Then a dialog asks "is cancelled, and the ticket gets one fresh run"
    When I choose "OK" in the dialog
    Then the page says "Restarted 1 run."
    And the disposable run is "cancelled"
    When I visit the disposable ticket
    Then the ticket page does not offer "Restart runs"

  Scenario: A lead restarts a parked ticket
    Given I am signed in as "north-lead"
    And a disposable "bb_work" ticket in state "working" parked after repeated failed runs
    When I visit the disposable ticket
    Then the inspector names the stall "failing"
    When I open "Restart runs"
    And I choose "OK" in the dialog
    Then the disposable run is "cancelled"

  Scenario: Cancel closes Restart runs without a change
    Given I am signed in as "north-lead"
    And a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable ticket
    And I open "Restart runs"
    And I choose "Cancel" in the dialog
    Then the disposable run is "running"

  Scenario: A guest sees no Restart runs
    Given I am signed in as "north-guest"
    And a disposable "bb_work" ticket in state "working" whose last 1 runs failed with "ddev start failed"
    When I visit the disposable ticket
    Then the ticket page does not offer "Restart runs"
