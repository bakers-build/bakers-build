@feature:catalog-terms
Feature: Catalog manages types, recipes and labels
  Each term bundle has a Catalog tab under workspace settings that lists the
  workspace's terms; each row opens the term's edit form in the dialog, which
  saves back to the tab and offers Delete. The page header's Add action opens
  the add form; saving lands back on the tab. A term has no page of its own.
  Every rank that reads terms lists them; adding needs `create bb_term`, so a
  guest gets no term action.

  Scenario Outline: A lead adds a term on the <tab> tab and renames it in its dialog
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/catalog/<path>"
    Then the tab "<tab>" is current
    And the page header offers the action "Add <noun>"
    When I add the term "Added term <noun>" with the action "Add <noun>"
    Then the tab "<tab>" is current
    And the term "Added term <noun>" is listed
    And the page loaded its own assets without htmx transport keys
    When I open the term "Added term <noun>"
    And I rename the term in its dialog to "Renamed term <noun>"
    Then the tab "<tab>" is current
    And the term "Renamed term <noun>" is listed
    And the term "Added term <noun>" is not listed

    Examples:
      | tab     | path    | noun   |
      | Types   | types   | type   |
      | Recipes | recipes | recipe |
      | Labels  | labels  | label  |

  Scenario: A lead deletes a term from its dialog
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/catalog/labels"
    And I add the term "Deleted term label" with the action "Add label"
    And I open the term "Deleted term label"
    And I delete the term from its dialog
    Then the tab "Labels" is current
    And the term "Deleted term label" is not listed

  Scenario Outline: The <tab> tab lists the workspace's seeded terms
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/catalog/<path>"
    Then the tab "<tab>" is current
    And the term "<seeded>" is listed

    Examples:
      | tab    | path   | seeded  |
      | Types  | types  | feature |
      | Labels | labels | backend |

  Scenario: A contributor adds and renames a term but cannot delete it
    Given I am logged in as the account "north-contributor"
    When I visit "/bakers/settings/catalog/labels"
    And I add the term "Added term contributor" with the action "Add label"
    Then the term "Added term contributor" is listed
    When I open the term "Added term contributor"
    Then the term dialog offers no Delete
    When I rename the term in its dialog to "Renamed term contributor"
    Then the term "Renamed term contributor" is listed
    And the delete page of the term "Renamed term contributor" answers 403

  Scenario Outline: A guest lists the <tab> tab without a term action
    Given I am logged in as the account "north-guest"
    When I visit "/bakers/settings/catalog/<path>"
    Then the tab "<tab>" is current
    And the term "<seeded>" is listed
    And the page header does not offer the action "Add <noun>"

    Examples:
      | tab     | path    | noun   | seeded  |
      | Types   | types   | type   | feature |
      | Labels  | labels  | label  | backend |

  Scenario: A guest may not edit a term
    Given I am logged in as the account "north-guest"
    Then the edit page of the seeded label "backend" answers 403

  Scenario: A term has no page of its own
    Given I am logged in as the account "north-lead"
    Then the page of the seeded label "backend" answers 404

  @nojs
  Scenario: A lead adds a term without JavaScript
    Given I am logged in as the account "north-lead"
    When I visit "/bakers/settings/catalog/labels"
    And I add the term "Added term label no-JS" with the action "Add label"
    Then the tab "Labels" is current
    And the term "Added term label no-JS" is listed
