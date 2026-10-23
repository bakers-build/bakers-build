@feature:markdown-output
Feature: Markdown output
  Stored bb_rich Markdown renders through ONE output component,
  `bb_theme:rich-text`, wherever a ticket shows a body: the description in
  About, the summary in the band and every comment in the handoff stream. The
  format turns pipe tables into real tables; the component styles them and
  keeps a wide one inside the body instead of widening the page.

  The fixtures (recipes/bb_e2e, tickets APIS-1..3 and their comments) are
  read-only for every other test, so their stored source can be compared before
  and after the reads below. The reader is `north-contributor`, an ordinary member of
  Northside Bakery — never an administrator.

  Background:
    Given I am logged in as the account "north-contributor"

  Scenario: Every body surface of the ticket uses the shared output component
    Given the stored Markdown of "APIS-1" and its comments is remembered
    When I visit the ticket "APIS-1"
    And I open the handoff stream
    Then the description, the summary and 2 handoff comments render through rich-text
    And every rich-text body shows the release-check table
    And the table scroll regions have distinct accessible names
    And the stored Markdown of "APIS-1" and its comments is unchanged and still bb_rich

  Scenario: Markdown preserves table content and formatting semantics
    When I visit the ticket "APIS-1"
    Then the About body has a table with the column headers "Check, Result, Notes"
    And the About body table has the rows "Build|Passed|See details." and "Parser|Pending|Preserve a|b and Grüße." and "Empty||A deliberately empty middle cell."
    And the About body shows a header-only table with the column headers "Only, Header, Row"
    And the About body is not clamped and offers no Show more toggle
    And the About body shows the formatting corpus
    And the About body shows "Text after the table must remain visible."

  Scenario Outline: A wide table scrolls inside the body at <width> pixels
    Given the navigation rail has no remembered state
    And the viewport is <width> pixels wide
    When I visit the ticket "APIS-1"
    Then the rich-text bodies add no horizontal page overflow
    And the About body is a named, focusable scroll region wider than its viewport
    When I focus the About body and scroll it right with the keyboard
    Then the column header "Owner" of the About body is inside its scroll region

    Examples:
      | width |
      | 320   |
      | 390   |

  Scenario: Unsafe input stays filtered and code shows HTML literally
    When I visit the ticket "APIS-2"
    Then no injected script ran
    And the About body contains no script, image or javascript link
    And the About body code block reads "<b>literal HTML in code</b>"

  Scenario: An empty description renders no body
    When I visit the ticket "APIS-3"
    Then no About body is rendered

  Scenario: The output survives two island navigations
    Given I visit the ticket "APIS-1"
    When I click the rail entry "North Crew"
    Then the document was not reloaded
    When I go back
    Then the document was not reloaded
    And the About body has a table with the column headers "Check, Result, Notes"
    When I click the rail entry "North Crew"
    Then the document was not reloaded
    When I go back
    Then the document was not reloaded
    And the About body has a table with the column headers "Check, Result, Notes"
    And the About body shows "Text after the table must remain visible."

  @tenancy
  Scenario: A reader outside the workspace cannot read the body
    Given I am logged in as the account "no-bakery"
    When I request the ticket "APIS-1" in the workspace "bakers"
    Then the response status is 403
    And the page does not show "Release checks"

  @nojs
  Scenario: Without JavaScript every table row and the trailing text are readable
    When I visit the ticket "APIS-1"
    Then the About body is not clamped and offers no Show more toggle
    And the About body table has the rows "Build|Passed|See details." and "Parser|Pending|Preserve a|b and Grüße." and "Empty||A deliberately empty middle cell."
    And the About body shows "Text after the table must remain visible."
