@feature:listing-rows
Feature: The workspace listings are list rows ordered by one sort dropdown
  Projects, groups, tickets and runs render through one patterned
  `bb_theme:list`: a headline, a meta line or a description, and a
  right-hand column per row, and no table. A "Search and sort" toolbar sits directly above the
  rows: one search field and one "Sort by" select, outside the exposed form
  but bound to it through their `form` attribute. Search, sort and the
  facets therefore submit as one GET form, so each has to survive the
  others, paging and a reload, and every navigating scenario acts TWICE: a
  boost declaration lost in a swap survives the first interaction.

  Background:
    Given the listing indexes are up to date
    And I am signed in as a member of the "bakers" workspace

  Scenario Outline: The <listing> rows follow the sort dropdown through filtering, paging and reload
    When I open the "<listing>" row listing
    Then the rows are list items and no table is rendered
    And the search toolbar sits directly above the rows
    When I sort the listing by "<desc>"
    Then the rows are ordered descending by their "<key>" value
    When I sort the listing by "<asc>"
    Then the rows are ordered ascending by their "<key>" value
    When I apply the listing's sample filter
    Then the sort dropdown still reads "<asc>"
    And the rows are ordered ascending by their "<key>" value
    When I page forward if the listing has another page
    Then the sort dropdown still reads "<asc>"
    And the rows are ordered ascending by their "<key>" value
    When I reload the row listing
    Then the sort dropdown still reads "<asc>"
    And the rows are ordered ascending by their "<key>" value
    When I follow the first row's "<link>" link
    And I return to the row listing
    And I follow the first row's "<link>" link
    Then the detail page of that row is shown

    Examples:
      | listing  | desc            | asc            | key        | link       |
      | Projects | name_DESC       | name_ASC       | name       | name       |
      | Groups   | name_DESC       | name_ASC       | name       | name       |
      | Tickets  | identifier_DESC | identifier_ASC | identifier | identifier |
      | Runs     | started_at_DESC | started_at_ASC | started_at | identifier |

  Scenario Outline: A <listing> search narrows the rows and survives sort, filters and reload
    When I open the "<listing>" row listing
    Then the search toolbar sits directly above the rows
    When I note the listed row count
    And I type "<query>" into the listing search
    Then only rows matching the search are listed
    When I sort the listing by "<sort>"
    Then the sort dropdown still reads "<sort>"
    And only rows matching the search are listed
    When I show all rows with the closed control where the listing has one
    Then the sort dropdown still reads "<sort>"
    And only rows matching the search are listed
    When I reload the row listing
    Then the sort dropdown still reads "<sort>"
    And only rows matching the search are listed
    When I clear the listing search
    Then the rows before the search are listed again
    When I click the first row outside its links
    Then the detail page of that row is shown
    When I return to the row listing
    And I click the first row outside its links
    Then the detail page of that row is shown

    Examples:
      | listing  | query    | sort            |
      | Projects | ALPN     | name_DESC       |
      | Groups   | Alpha    | name_DESC       |
      | Tickets  | Pager fixture | identifier_DESC |
      | Runs     | dropsh   | started_at_ASC  |

  Scenario Outline: A click anywhere on a <listing> row opens it, twice
    When I open the "<listing>" row listing
    And I click the first row outside its links
    Then the detail page of that row is shown
    When I return to the row listing
    And I click the first row outside its links
    Then the detail page of that row is shown

    Examples:
      | listing  |
      | Projects |
      | Groups   |
      | Tickets  |
      | Runs     |

  # The rail remembers its open state in localStorage; a desktop scenario
  # earlier in the same worker would otherwise open it on a phone width.
  Scenario Outline: The <listing> rows read without horizontal scrolling at 390px
    Given the viewport is 390 pixels wide
    And the rail has no remembered state
    When I open the "<listing>" row listing
    Then the first row's "<key>" value is fully visible
    And the document does not scroll horizontally

    Examples:
      | listing  | key        |
      | Projects | name       |
      | Groups   | name       |
      | Tickets  | identifier |
      | Runs     | identifier |

  # A project or group row leads with its avatar — the image, else initials —
  # and ends its text block with the description, which the seeded
  # "bakers-e2e-project" and "keytec" carry and every other seeded row lacks.
  Scenario Outline: The <listing> rows lead with an avatar and end with a description
    When I open the "<listing>" row listing
    Then every row starts with its avatar
    And the row "<name>" shows the description "<fragment>" beneath its title
    And a row without a description shows no description region

    Examples:
      | listing  | name             | fragment                                       |
      | Projects | bakers-e2e-project | The end-to-end world's own project             |
      | Groups   | keytec           | The group every end-to-end project belongs to. |

  # Projects count open, open-with-a-conductor and closed tickets; groups
  # count their projects. The badge title explains each number on hover.
  Scenario Outline: The <listing> rows explain their counts and date them
    When I open the "<listing>" row listing
    Then every row shows the counts "<counts>" with an icon and beneath them "<caption>"

    Examples:
      | listing  | counts                                                       | caption |
      | Projects | open tickets? · open tickets? with a conductor · closed tickets? | Created |
      | Groups   | projects?                                                    | Updated |

  # A ticket row: its state as a named glyph, the title, then the identifier
  # and when and by whom it was created, and the assignee's mark on the right.
  Scenario: The ticket rows show the state glyph, the creation line and the assignee mark
    When I open the "Tickets" row listing
    Then every ticket row leads with a state glyph named by its state
    And every ticket row reads its identifier and "Created … ago" beneath the title
    And every ticket row ends with the assignee's mark, named by its tooltip

  Scenario Outline: The <listing> avatar and description stay inside the row at <width>px
    Given the viewport is <width> pixels wide
    And the rail has no remembered state
    When I open the "<listing>" row listing
    Then the row "<name>" keeps its avatar left of its headline and inside the row
    And the document does not scroll horizontally

    Examples:
      | listing  | width | name             |
      | Projects | 320   | bakers-e2e-project |
      | Projects | 390   | bakers-e2e-project |
      | Groups   | 320   | keytec           |
      | Groups   | 390   | keytec           |

  Scenario: The sort dropdown is operated with the keyboard, twice
    When I open the "Tickets" row listing
    And I move the sort dropdown one option down with the keyboard
    Then the sort dropdown still reads "changed_ASC"
    When I move the sort dropdown one option down with the keyboard
    Then the sort dropdown still reads "identifier_ASC"
    And the rows are ordered ascending by their "identifier" value

  # Standard Views/BEF validation: an illegal choice marks the select invalid
  # and aborts the query, so nothing is listed and nothing errors.
  Scenario: An unknown sort value is refused without breaking the listing
    When I open the "Tickets" row listing with the sort value "bogus_DESC"
    Then the listing answered without a server error
    And the sort dropdown is marked invalid
    And no row is listed
