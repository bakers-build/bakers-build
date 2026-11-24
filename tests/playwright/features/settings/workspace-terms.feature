@feature:workspace-terms
Feature: Workspace settings manage types, recipes and labels
  Each term bundle has a Settings tab after Templates that lists the
  workspace's terms; each row links to the term's page, which carries Edit and
  Delete. The page header's Add action opens the add form; saving lands back
  on the tab. Editing from the term's page returns to it. Like every workspace
  settings page, the tabs are closed to a guest, and a guest gets no term
  action; adding needs `create bb_term`.

  Scenario Outline: A lead adds a term on the <tab> tab and renames it on its page
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
    And the page loaded its own assets without htmx transport keys
    When I open the term "Added term <noun>"
    Then the term page shows "Added term <noun> from the Settings tab."
    When I rename the term on its page to "Renamed term <noun>"
    Then the term page shows "Renamed term <noun> from the Settings tab."
    And the page loaded its own assets without htmx transport keys
    When I visit "/bakers/settings/<path>"
    Then the term "Renamed term <noun>" is listed
    And the term "Added term <noun>" is not listed

    Examples:
      | tab     | path    | noun   |
      | Types   | types   | type   |
      | Recipes | recipes | recipe |
      | Labels  | labels  | label  |

  Scenario Outline: A lead leaves a term's edit form on the <tab> tab by Cancel
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/<path>"
    And I add the term "Kept term <noun>" with the action "Add <noun>"
    And I open the term "Kept term <noun>"
    And I rename the term on its page to "Discarded term <noun>" and cancel
    Then the term page shows "Kept term <noun> from the Settings tab."
    When I visit "/bakers/settings/<path>"
    Then the term "Kept term <noun>" is listed
    And the term "Discarded term <noun>" is not listed

    Examples:
      | tab     | path    | noun   |
      | Recipes | recipes | recipe |
      | Labels  | labels  | label  |

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

  Scenario: A guest gets no term action
    Given I am logged in as the account "north-guest"
    When I visit the page of the seeded label "backend"
    Then the page offers no term action
    And the edit page of the seeded label "backend" answers 403

  @nojs
  Scenario: A lead adds a term without JavaScript
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/labels"
    And I add the term "Added term label no-JS" with the action "Add label"
    Then the tab "Labels" is current
    And the term "Added term label no-JS" is listed
