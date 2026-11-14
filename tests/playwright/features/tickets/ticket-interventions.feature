@feature:ticket-interventions
Feature: A person intervenes on the ticket page while agents drive the workflow
  The ticket page offers no workflow step: AI agents move the ticket. A person
  freezes or unfreezes the ticket, cancels it from the Properties footer or one
  run from its own row, retries a failed run, each confirmed in a dialog, and reaches the few
  exception fields through More settings. A closed ticket is read-only. Every
  scenario works on its own disposable ticket so the seeded fixtures stay
  untouched.

  Background:
    Given I am logged in as "Administrator"

  Scenario: Cancel ticket asks first and keeping it changes nothing
    Given a disposable "bb_work" ticket in state "working"
    When I visit the disposable ticket
    Then the ticket page offers no workflow step
    When I open "Cancel ticket"
    Then a dialog asks "Cancel"
    When I choose "Keep the ticket" in the dialog
    Then the disposable ticket is in state "working"
    When I open "Cancel ticket"
    And I choose "Cancel ticket" in the dialog
    Then the disposable ticket is in state "cancelled"
    And the page says "is now Cancelled"

  Scenario: Freeze ticket asks first, ends the run and names the stall
    Given a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable ticket
    Then the ticket page offers "Freeze ticket"
    When I open "Freeze ticket"
    Then a dialog asks "will not be claimed"
    And a dialog asks "active run is ended"
    When I choose "Freeze ticket" in the dialog
    Then the page says "is frozen"
    And the disposable run is "cancelled"
    And the inspector names the stall "frozen"
    When I visit the disposable ticket
    Then the ticket page offers "Unfreeze ticket"
    When I open "Unfreeze ticket"
    Then a dialog asks "can be claimed again"
    When I choose "Unfreeze ticket" in the dialog
    Then the page says "is no longer frozen"

  @nojs
  Scenario: Freeze ticket works without JavaScript as a page
    Given a disposable "bb_work" ticket in state "review"
    When I visit the disposable ticket
    And I open "Freeze ticket"
    Then the confirmation is a page of its own
    When I choose "Freeze ticket" on the page
    Then the page says "is frozen"

  Scenario: A closed ticket is read-only
    Given a disposable "bb_work" ticket in state "done"
    When I visit the disposable ticket
    Then the Properties block offers no picker
    And the ticket page offers no intervention

  Scenario: Cancel run stops only that run and leaves the ticket's state
    Given a disposable "bb_work" ticket in state "working" with a running run
    When I visit the disposable ticket
    And I open "Cancel run" on the disposable run's own row
    Then the dialog names the disposable run and that the conductor may start another run
    And the dialog's first choice is "Keep the run"
    When I choose "Cancel run" in the dialog
    Then the disposable run is "cancelled"
    And the disposable ticket is in state "working"

  Scenario: Retry a failed run
    Given a disposable "bb_work" ticket in state "working" whose last 3 runs failed with "plugins: claude install failed: 401"
    When I visit the disposable ticket
    Then the disposable run's row says why it failed: "plugins: claude install failed: 401"
    And the disposable run's row offers "Re-dispatch"
    And the disposable run's row offers "Log"
    When I open "Retry" on the disposable run's own row
    Then a dialog asks "again on its next check, and the new run appears in Run history."
    When I choose "Retry run" in the dialog
    Then the page says "Retry requested."
    When the ticket's conductor claims the disposable ticket on its next check
    And I visit the disposable ticket
    Then the newest run in Run history is "claimed"

  Scenario: A guest reads why a run failed but gets no run action and no log
    Given I am signed in as "north-guest"
    And a disposable "bb_work" ticket in state "working" whose last 3 runs failed with "plugins: claude install failed: 401"
    When I visit the disposable ticket
    Then the disposable run's row says why it failed: "plugins: claude install failed: 401"
    And the disposable run's row does not offer "Log"
    And the ticket page offers no intervention

  Scenario: Settings open inside the app and offer only the exception fields
    Given a disposable "bb_work" ticket in state "plan"
    When I visit the disposable ticket
    And I open "More settings"
    Then the Settings screen renders inside the app shell
    And the Settings screen offers only title, description and env vars
    When I open "Back to ticket"
    And I open "More settings"
    Then the Settings screen renders inside the app shell

  @nojs
  Scenario: Cancel ticket works without JavaScript as a page
    Given a disposable "bb_work" ticket in state "review"
    When I visit the disposable ticket
    And I open "Cancel ticket"
    Then the confirmation is a page of its own
    When I choose "Cancel ticket" on the page
    Then the disposable ticket is in state "cancelled"
