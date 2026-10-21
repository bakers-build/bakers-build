@feature:island-standard-menu
Feature: Standard Menu placements keep their configured depth and navigation target
  Two placements of one menu may show different depths. Each click refreshes
  its source menu and the controller content while retaining the other menu.

  Scenario Outline: The <menu> menu still navigates after its first replacement
    Given I am logged in as "Administrator"
    And I open the standard menu fixture
    Then the standard menus retain their configured depths
    And the menu controller shows "first"
    When I follow the "<menu>" standard menu to "second"
    Then the document was not reloaded
    And exactly the clicked menu and controller were replaced in one request
    And the standard menus retain their configured depths
    When I follow the "<menu>" standard menu to "first"
    Then the document was not reloaded
    And exactly the clicked menu and controller were replaced in one request
    And the standard menus retain their configured depths

    Examples:
      | menu    |
      | shallow |
      | deep    |
