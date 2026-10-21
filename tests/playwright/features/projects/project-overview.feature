@feature:project-overview
Feature: Project Overview shows whether the project is running
  The project canonical address is Overview: description, Activities, and an
  inspector of Properties and Epics. Count figures belong on the Board.
  The body is the `full` view mode, not a controller.
  Navigation runs inside the content island, so a navigating scenario clicks
  twice.

  @shell
  Scenario: A lead opens a project Overview from the listing
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    And I click the project "bakers.build Platform" in the listing
    Then the address is the detail of the project "bakers.build Platform"
    And the page heading is "bakers.build Platform"
    And the tab "Overview" is current
    And the project Overview shows Activities, Properties and Epics
    And the Overview body carries no controller hull

  Scenario: Clicking back to Overview as the second click keeps the island alive
    Given I am signed in as a member of the "bakers" workspace
    And I visit the project "bakers.build Platform"
    When I click the tab "Tickets"
    Then the address ends with "/tickets"
    And the document was not reloaded
    And the tab "Tickets" is current
    When I click the tab "Overview"
    Then the document was not reloaded
    And the tab "Overview" is current
    And the project Overview shows Activities, Properties and Epics

  Scenario: The project Overview shows no count figures
    Given I am signed in as a member of the "bakers" workspace
    When I visit the project "bakers.build Platform"
    Then the project Overview shows no count figures

  # The cards share one sticky panel: separate sticky panels slid over each
  # other while scrolling and hid a lower card's Save.
  Scenario: The inspector cards share one panel that fills the inspector column
    Given I am signed in as a member of the "bakers" workspace
    When I visit the project "bakers.build Platform"
    Then the inspector holds exactly one panel
    And inspector panels fill the inspector column
