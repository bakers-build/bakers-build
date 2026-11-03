@feature:conductor-properties
Feature: A conductor owner edits and disables a conductor on its Overview
  The conductor Overview is a detail page: Activities beside one Identity
  card. Its label is editable; variant, project, machine, owner and UUID are
  read-only, and Disable or Enable sits below it. The page shows none of the
  conductor's states, status, last seen and load: the heartbeat writes the
  last three, the states are set at registration. The owner saves the label with its own Save and disables or enables
  the conductor through a confirmation. A peer only reads the card. There is
  no Settings tab; the administrative edit form stays where it was.
  Activities list the claims of this conductor's own runs that the reader may
  inspect. The scenarios work on dedicated fixture conductors, restored
  afterwards.

  Scenario: The owner saves the label on the one card
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties"
    Then there is no tab "Settings"
    And the first card is "Identity"
    And the detail page has no "Configuration" card
    And the detail page has no "Status" card
    And the detail page has no "Last seen" card
    And the detail page has no "Reported load" card
    And the detail page has no "Live occupancy" card
    And the "Identity" card offers "Label" with Save
    And the "Identity" card shows "Variant" as "conductor"
    And the "Identity" card shows "UUID" as "1f1764cf-f41e-4077-8495-2bce8ed508b2"
    And the "Identity" card has no row "States"
    When I set "Label" to "Owner renamed conductor" in the "Identity" card
    And I save the "Identity" card
    Then the "Identity" card says "saved."
    And the page heading is "Owner renamed conductor"
    And the fixture conductor "conductor.properties" has the label "Owner renamed conductor"
    And the fixture conductor "conductor.properties" serves the states "working"

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
    And the fixture conductor "conductor.properties" answers 403 on "card/identity"
    And the fixture conductor "conductor.properties" answers 404 on "card/configuration"
    And the fixture conductor "conductor.properties" answers 403 on "action"

  Scenario: Activities list only the claims of this conductor's runs a reader may inspect
    Given I am logged in as the account "north-contributor"
    When I visit the fixture conductor "conductor.properties"
    Then the Activities list "APIH-1 started work in plan"
    Given I am logged in as the account "fixture-conductor-owner"
    When I visit the fixture conductor "conductor.properties"
    Then the Activities say "No activity yet."

  Scenario: The instance admin keeps the card and the administrative edit form
    Given I am logged in as the account "site-admin"
    When I visit the fixture conductor "conductor.properties"
    Then the "Identity" card offers "Label" with Save
    When I open "Disable conductor"
    And I choose "Keep enabled" in the dialog
    Then the fixture conductor "conductor.properties" is active
    And the fixture conductor "conductor.properties" administrative edit form answers 200

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
