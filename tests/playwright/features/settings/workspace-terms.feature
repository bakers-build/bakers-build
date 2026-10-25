@feature:workspace-terms
Feature: Workspace settings manage types, recipes and labels
  Each term bundle has a Settings tab after Templates that lists the
  workspace's terms with an Edit operation. The page header's Add action opens
  the add form; saving lands back on the tab. A term has no page of its own.
  Like every workspace settings page, the tabs are closed to a guest; adding
  needs `create bb_term`.

  Scenario Outline: A lead adds and renames a term on the <tab> tab
    Given I am logged in as the account "north-lead"
    When I visit My work
    And I click the rail entry "Settings"
    And I click the tab "Templates"
    And I click the tab "<tab>"
    Then the tab "<tab>" is current
    And the page header offers the action "Add <noun>"
    When I add the term "Added term <noun>" with the action "Add <noun>"
    Then the tab "<tab>" is current
    And the term "Added term <noun>" is listed
    When I rename the term "Added term <noun>" to "Renamed term <noun>"
    Then the tab "<tab>" is current
    And the term "Renamed term <noun>" is listed
    And the term "Added term <noun>" is not listed
    And the term "Renamed term <noun>" has no page of its own

    Examples:
      | tab     | noun   |
      | Types   | type   |
      | Recipes | recipe |
      | Labels  | label  |

  Scenario Outline: The <tab> tab lists the workspace's seeded terms
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/<path>"
    Then the tab "<tab>" is current
    And the term "<seeded>" is listed

    Examples:
      | tab    | path   | seeded  |
      | Types  | types  | feature |
      | Labels | labels | backend |

  Scenario Outline: A guest cannot open the <tab> tab
    Given I am logged in as the account "north-guest"
    When I visit "/bakers/settings/<path>"
    Then the page is not found or forbidden

    Examples:
      | tab     | path    |
      | Types   | types   |
      | Recipes | recipes |
      | Labels  | labels  |

  @nojs
  Scenario: A lead adds a term without JavaScript
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/labels"
    And I add the term "Added term label no-JS" with the action "Add label"
    Then the tab "Labels" is current
    And the term "Added term label no-JS" is listed
