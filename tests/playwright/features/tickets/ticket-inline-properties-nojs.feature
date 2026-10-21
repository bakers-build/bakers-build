@feature:ticket-inline-properties
Feature: Ticket properties persist inline without JavaScript
  Own fixture ticket (BB-145), separate from ticket-inline-properties.feature's
  BB-142: the `@nojs` tag schedules this scenario as its own concurrent
  Playwright project, and sharing a fixture with the js-project scenarios let
  their writes race this one's whole-map restore assertion.

  Background:
    Given I am logged in as "Administrator"
    And I visit the ticket "BB-145"
    And I remember the inline properties for cleanup
    And the Properties block holds the property pickers and Created by

  @nojs
  Scenario: Manual Save remains available without JavaScript
    Then the property form has a usable manual Save button
