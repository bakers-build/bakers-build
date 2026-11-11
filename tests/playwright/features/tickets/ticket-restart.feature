@feature:ticket-interventions
Feature: A person restarts a ticket parked after repeated failed runs
  When three runs in a row fail, the ticket is parked and conductors skip it.
  Once the cause is fixed, a person who may update the ticket restarts it from
  the Properties footer: its newest failed run becomes cancelled, so the ticket
  can be claimed again, and every run stays in its history. A guest who may
  only view the ticket gets no Restart. Every scenario works on its own
  disposable ticket so the seeded fixtures stay untouched.

  Scenario: A lead restarts a ticket parked after repeated failed runs
    Given I am signed in as "north-lead"
    And a disposable "bb_work" ticket in state "working" parked after repeated failed runs
    When I visit the disposable ticket
    Then the inspector names the stall "failing"
    And the ticket page offers "Restart ticket"
    When I open "Restart ticket"
    Then a dialog asks "can be claimed again"
    When I choose "Restart ticket" in the dialog
    Then the page says "was restarted"
    When I visit the disposable ticket
    Then the ticket page does not offer "Restart ticket"

  Scenario: A guest sees no Restart on a parked ticket
    Given I am signed in as "north-guest"
    And a disposable "bb_work" ticket in state "working" parked after repeated failed runs
    When I visit the disposable ticket
    Then the inspector names the stall "failing"
    And the ticket page does not offer "Restart ticket"
