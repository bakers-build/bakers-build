@feature:conductor-properties
Feature: A conductor owner edits a conductor on its Settings and disables it on its Overview
  The conductor Overview is a detail page: Activities beside one read-only
  Identity card, with Disable or Enable below it. The page shows none of the
  conductor's status, last seen and load: the heartbeat writes them. The
  owner's Settings tab edits the label, served states and assignment, and
  offers Delete to whoever may delete it, the instance admin; the owner disables or enables the conductor through a
  confirmation. A peer only reads the card and gets no Settings. There is no
  administrative edit form.
  Activities list the claims of this conductor's own runs that the reader may
  inspect. The scenarios work on dedicated fixture conductors, restored
  afterwards.

  Scenario: The owner reads the card and saves the label and states on Settings
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties"
    Then the tab "Settings" is offered
    And the first card is "Identity"
    And the detail page has no "Configuration" card
    And the detail page has no "Status" card
    And the detail page has no "Last seen" card
    And the detail page has no "Reported load" card
    And the detail page has no "Live occupancy" card
    And the "Identity" card offers no Save and no inputs
    And the "Identity" card shows "Label" as "BDD properties conductor"
    And the "Identity" card shows "Conductor ID" as "bdd-properties-conductor"
    And the "Identity" card shows "Effective assignment" as "forbid (machine)"
    When I click the tab "Settings"
    Then the Settings offer "Label"
    And the Settings offer "States"
    And the Settings offer "Assignment"
    When I set "Label" to "Owner renamed conductor" on the Settings
    And I choose "plan, working" for "States" on the Settings
    And I save the Settings
    Then the fixture conductor "conductor.properties" has the label "Owner renamed conductor"
    And the fixture conductor "conductor.properties" serves the states "plan, working"
    When I visit the fixture conductor "conductor.properties"
    Then the page heading is "Owner renamed conductor"
    And the "Identity" card shows "Label" as "Owner renamed conductor"

  Scenario: The owner disables and enables the conductor behind a confirmation
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties"
    And I open "Disable conductor"
    Then a dialog asks "stops receiving new assignments"
    When I choose "Keep enabled" in the dialog
    Then the fixture conductor "conductor.properties" is active
    When I open "Disable conductor"
    And I choose "Disable conductor" in the dialog
    Then the fixture conductor "conductor.properties" is inactive
    When I open "Enable conductor"
    And I choose "Enable conductor" in the dialog
    Then the fixture conductor "conductor.properties" is active

  Scenario: A peer reads the card and is refused the forms
    Given I am logged in as the account "north-contributor"
    When I visit the fixture conductor "conductor.properties"
    Then the "Identity" card offers no Save and no inputs
    And the conductor offers no Disable or Enable
    And there is no tab "Settings"
    And the fixture conductor "conductor.properties" answers 403 on "settings"
    And the fixture conductor "conductor.properties" answers 404 on "card/identity"
    And the fixture conductor "conductor.properties" answers 404 on "card/configuration"
    And the fixture conductor "conductor.properties" answers 403 on "action"

  Scenario: Activities list only the claims of this conductor's runs a reader may inspect
    Given I am logged in as the account "north-contributor"
    When I visit the fixture conductor "conductor.properties"
    Then the Activities list "APIH-1 started work in plan"
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties"
    Then the Activities say "No activity yet."

  Scenario: The instance admin gets Settings; the administrative edit form is gone
    Given I am logged in as the account "site-admin"
    When I visit the fixture conductor "conductor.properties"
    Then the tab "Settings" is offered
    And the "Identity" card offers no Save and no inputs
    When I click the tab "Settings"
    Then the Settings offer the action "Delete conductor"
    When I visit the fixture conductor "conductor.properties"
    And I open "Disable conductor"
    And I choose "Keep enabled" in the dialog
    Then the fixture conductor "conductor.properties" is active
    And the fixture conductor "conductor.properties" administrative edit form answers 404

  @nojs
  Scenario: Disable and enable work without JavaScript as pages
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties-nojs"
    And I open "Disable conductor"
    Then the conductor confirmation is a page of its own
    When I choose "Disable conductor" on the page
    Then the fixture conductor "conductor.properties-nojs" is inactive
    When I open "Enable conductor"
    And I choose "Enable conductor" on the page
    Then the fixture conductor "conductor.properties-nojs" is active
