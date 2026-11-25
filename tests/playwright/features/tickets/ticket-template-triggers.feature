@feature:ticket-template-triggers
Feature: A template schedules its own tickets
  A ticket template has a Triggers tab, a Views page listing its triggers with
  an Add trigger action in the page header. Each row links to the trigger's
  page, which carries Edit, Pause or Resume, and Delete. A lead adds a monthly
  time trigger run by a workspace service account (the schedule offers only the
  fields of its frequency, refreshed over htmx), sees it enabled with its next
  run in the trigger's own zone, opens it, and pauses and resumes it there in
  the overlay dialog, which its close button dismisses without a change. A
  guest gets no trigger action. A trigger cannot be enabled
  without a service account. Ticket creation by cron is covered by the kernel
  runner tests; only function and visibility are asserted here.

  Scenario: The seeded monthly trigger is listed with its next run
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I click the tab "Overview"
    And I click the tab "Triggers"
    Then the tab "Triggers" is current
    And the trigger "Monthly on day 1 at 09:00 (Europe/Berlin)" is listed as "Enabled"
    And the trigger "Monthly on day 1 at 09:00 (Europe/Berlin)" runs next on the coming 1st at "09:00"
    And the page header offers the action "Add trigger"

  Scenario: A lead adds a trigger, then pauses and resumes it on its page
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I add an enabled monthly trigger on day "28" at "07:15" in "Europe/Berlin" run by "fixture-automation"
    Then the trigger "Monthly on day 28 at 07:15 (Europe/Berlin)" is listed as "Enabled"
    When I open the trigger "Monthly on day 28 at 07:15 (Europe/Berlin)"
    Then the trigger page shows the state "Enabled"
    When I open "Pause" on the trigger page and close the dialog
    Then the trigger page shows the state "Enabled"
    When I "Pause" on the trigger page
    Then the trigger page shows the state "Paused"
    When I visit the triggers of the template "Monthly Drupal update" by their address
    Then the trigger "Monthly on day 28 at 07:15 (Europe/Berlin)" is listed as "Paused"
    And the trigger "Monthly on day 28 at 07:15 (Europe/Berlin)" has no next run
    When I open the trigger "Monthly on day 28 at 07:15 (Europe/Berlin)"
    And I "Resume" on the trigger page
    Then the trigger page shows the state "Enabled"

  Scenario: A guest gets no trigger action
    Given I am logged in as the account "north-guest"
    When I visit the seeded trigger by its address
    Then the page offers no trigger action
    And the Pause page of the seeded trigger answers 403

  Scenario: The schedule offers only the fields of its frequency
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I open the Add trigger action and choose the frequency "Daily"
    Then the trigger form does not offer the field "Weekday"
    And the trigger form does not offer the field "Day of month"
    When I choose the frequency "Weekly"
    Then the trigger form offers the field "Weekday"
    And the trigger form does not offer the field "Day of month"
    When I choose the frequency "Monthly"
    Then the trigger form offers the field "Day of month"
    And the trigger form does not offer the field "Weekday"

  Scenario Outline: A bare hour saves as the trigger time
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I add an enabled monthly trigger on day "<day>" at "8" in "Europe/Berlin" run by "fixture-automation"
    Then the trigger "Monthly on day <day> at 08:00 (Europe/Berlin)" is listed as "Enabled"

    Examples:
      | day |
      | 26  |

    @nojs
    Examples:
      | day |
      | 25  |

  Scenario: Leaving the trigger time completes a bare hour
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I open the Add trigger action and choose the frequency "Monthly"
    And I type "8" into the trigger time and leave it
    Then the trigger time shows "08:00"
    When I type "abc" into the trigger time and leave it
    Then the trigger time shows "abc"

  Scenario: The add dialog closes with Escape and its close button
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I open the Add trigger action and press Escape
    And I open the Add trigger action and click its close button
    Then the tab "Triggers" is current

  Scenario: Enabling without a service account is refused
    Given I am logged in as the account "north-lead"
    When I visit the template "Monthly Drupal update" by its address
    And I click the tab "Triggers"
    And I add an enabled monthly trigger on day "27" at "06:00" in "Europe/Berlin" run by "- None -"
    Then the page says "Choose a service account before enabling the trigger."
    And no trigger "Monthly on day 27 at 06:00 (Europe/Berlin)" exists

  Scenario: A member of another workspace cannot open the triggers
    Given I am logged in as the account "south-contributor"
    When I visit the triggers of the template "Monthly Drupal update" by their address
    Then the page heading is "403 — Access denied"
    And the page does not show "Monthly on day 1 at 09:00"

  Scenario: An anonymous visitor is sent to sign in
    Given I am logged in as "anonymous"
    When I visit the triggers of the template "Monthly Drupal update" by their address
    Then I am sent to sign in
    And the page does not show "Monthly on day 1 at 09:00"
