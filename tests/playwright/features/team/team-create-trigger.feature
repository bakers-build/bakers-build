@feature:team-create-trigger
Feature: The create trigger on a team screen starts from a clean address
  An htmx navigation adds core's `ajax_page_state` to its request. The create
  trigger on the screen it lands on must not copy it into its own address or
  its `destination`, or the page the dialog returns to arrives without its
  scripts.

  Scenario Outline: A team screen reached through the rail keeps htmx working after the create dialog
    Given I am logged in as the account "<persona>"
    And I open a themed workspace screen
    When I click the rail entry "<team>"
    And I click the tab "Tickets"
    Then the "New ticket" create trigger carries no transport parameter
    When I cancel the dialog of the "New ticket" create trigger
    And I click the rail entry "Projects"
    Then the address carries no transport parameter
    And htmx is loaded without a page error
    When I visit the destination of the create trigger
    Then htmx is loaded without a page error

    Examples:
      | persona           | team        |
      | north-lead        | Design Crew |
      | north-contributor | North Crew  |
