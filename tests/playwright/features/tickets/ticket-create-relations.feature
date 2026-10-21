@feature:ticket-create-relations
Feature: The create-ticket dialog relates a new ticket only within its project
  Parent and Blocked by offer and accept only tickets that are in the new
  ticket's project and visible to the creator. "cwiedemann" reads both
  "bakers.build Platform" and "bakers-e2e-project"; APIO-1 lies in a workspace that
  account cannot read; core's reference check refuses it first, naming only
  its id.

  Background:
    Given I am logged in as the account "cwiedemann"

  Scenario: A dialog opened on a project offers only that project's tickets
    When I visit the ticket list of project "bakers.build Platform"
    And I click the "New ticket" action
    Then the create-ticket dialog is present
    And the "Blocked by" picker offers "BB-100"
    And the "Blocked by" picker does not offer "GL-E2E-WFI"
    When I open the "Parent" picker
    Then the "Parent" picker offers "BB-100"
    And the "Parent" picker does not offer "GL-E2E-WFI"
    When I search the open picker for "E2E"
    Then the "Parent" picker does not offer "GL-E2E-WFI"

  Scenario: Changing the project refreshes both pickers
    When I visit the My work list
    And I click the "New ticket" action
    Then the "Parent" picker offers no tickets
    And the "Blocked by" picker offers no tickets
    When I choose the dialog project "bakers.build Platform"
    And I open the "Parent" picker
    And I pick the related ticket "BB-100"
    Then the "Parent" picker offers "BB-100"
    When I choose the dialog project "bakers-e2e-project"
    Then the "Parent" picker offers "GL-E2E-WFI"
    And the "Parent" picker does not offer "BB-100"
    And the "Blocked by" picker offers "GL-E2E-WFI"
    And the "Blocked by" picker does not offer "BB-100"
    And the form will submit nothing for "parent_id"

  Scenario: One parent and several blockers are stored as picked
    When I visit the ticket list of project "bakers.build Platform"
    And I click the "New ticket" action
    And I type "Related within bakers.build Platform" into the title line
    And I open the "Parent" picker
    And I pick the related ticket "BB-100"
    And I open the "Blocked by" picker
    And I pick the related ticket "BB-110"
    And I pick the related ticket "BB-118"
    And I submit the dialog
    Then the dialog closed
    And the stored ticket has parent "BB-100"
    And the stored ticket is blocked by "BB-110, BB-118"

  Scenario: Both relations may stay empty
    When I visit the ticket list of project "bakers.build Platform"
    And I click the "New ticket" action
    And I type "Unrelated within bakers.build Platform" into the title line
    And I submit the dialog
    Then the dialog closed
    And the stored ticket has no parent and no blockers

  Scenario Outline: A crafted cross-project relation is refused
    When I visit the ticket list of project "bakers.build Platform"
    And I click the "New ticket" action
    And I type "<title>" into the title line
    And I post "<ticket>" as "<name>" instead
    And I submit the dialog
    Then the dialog is still present
    And the dialog shows the error "<error>"
    And the title line still reads "<title>"
    And no ticket titled "<title>" was stored

    Examples:
      | title                     | ticket     | name         | error                                                    |
      | Crafted foreign parent    | GL-E2E-WFI | parent_id    | The parent ticket must be in this ticket's project.      |
      | Crafted foreign blocker   | GL-E2E-WFI | blocked_by[] | Choose open blocking tickets from this ticket's project. |
      | Crafted unreadable parent | APIO-1     | parent_id    | cannot be referenced                                     |
