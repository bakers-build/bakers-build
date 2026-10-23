@feature:markdown-authoring
Feature: A Markdown toolbar over every bb_rich body
  Every body written in the bb_rich format — a ticket description on create
  and edit, a review body, a ticket template description — gets a formatting
  toolbar above its textarea. The toolbar only inserts Markdown syntax: what
  is stored is exactly the text in the box, in the bb_rich format. Other
  textareas stay plain boxes, a read-only body gets no toolbar, and without
  JavaScript the plain textarea still works.

  Scenario Outline: Each toolbar button applies its Markdown to the selection
    Given I am logged in as the account "north-lead"
    And I open the create-ticket dialog from the ticket list
    Then the "Description" field has a Markdown toolbar
    When I write "<text>" in the "Description" field
    And I select all of the "Description" field
    And I press the Markdown button "<button>" of the "Description" field
    Then the "Description" field reads "<result>"

    Examples:
      | button        | text           | result                 |
      | Heading       | Export         | ## Export              |
      | Bold          | Export         | **Export**             |
      | Italic        | Export         | _Export_               |
      | Code          | Export         | `Export`               |
      | Link          | Export         | [Export](url)          |
      | Bullet list   | Export\nImport | - Export\n- Import     |
      | Numbered list | Export\nImport | 1. Export\n2. Import   |
      | Bold          |                | ****                   |
      | Italic        |                | __                     |
      | Code          |                | ``                     |
      | Link          |                | [](url)                |

  Scenario: The saved description is exactly the Markdown in the box
    Given I am logged in as the account "north-lead"
    And I open the create-ticket dialog from the ticket list
    When I type "Markdown stored as typed" into the title line
    And I write "## A\n\n<b>x</b> y\n\n" in the "Description" field
    And I select "y" in the "Description" field
    And I press the Markdown button "Bold" of the "Description" field
    Then the "Description" field reads "## A\n\n<b>x</b> **y**\n\n"
    When I submit the dialog
    Then the dialog closed
    And the newest ticket titled "Markdown stored as typed" stores the description "## A\n\n<b>x</b> **y**\n\n" in "bb_rich"

  Scenario: The toolbar survives a refused submit
    Given I am logged in as the account "north-lead"
    And I open the create-ticket dialog from the ticket list
    When I write "Export" in the "Description" field
    And I submit the ticket dialog without browser validation
    Then the dialog is still present
    And a form-level error is shown above the body
    And the "Description" field has a Markdown toolbar
    When I select "Export" in the "Description" field
    And I press the Markdown button "Bold" of the "Description" field
    Then the "Description" field reads "**Export**"

  Scenario Outline: The toolbar is reachable and operable with the keyboard alone
    Given I am logged in as the account "north-lead"
    And I open the create-ticket dialog from the ticket list
    When I write "Export" in the "Description" field
    And I select "Export" in the "Description" field
    And I reach the Markdown toolbar of the "Description" field with Shift+Tab
    Then the focused Markdown button is "Heading"
    When I press the key "ArrowRight"
    Then the focused Markdown button is "Bold"
    When I press the key "<key>"
    Then the "Description" field reads "**Export**"
    And the dialog is still present

    Examples:
      | key   |
      | Enter |
      | Space |

  Scenario: Editing a ticket offers the toolbar on its description only
    Given a disposable review ticket assigned to "north-lead" with reviewer "north-guest"
    And I am logged in as the account "north-lead"
    When I visit the disposable review ticket
    And I follow the "More settings" action
    Then the "Description" field has a Markdown toolbar
    And the "Environment variables" field has no Markdown toolbar

  Scenario: A review body has the toolbar while drafted and none once submitted
    Given a disposable review ticket assigned to "north-lead" with reviewer "north-guest"
    And I am logged in as the account "north-guest"
    When I visit the disposable review ticket
    And I start writing a review
    Then the "Body" field has a Markdown toolbar
    Given "north-guest" submitted the review "Ship it with the empty state"
    And I am logged in as the account "north-lead"
    When I open the review by "north-guest" in its review form
    Then the "Body" field has no Markdown toolbar

  Scenario: A ticket template description has the toolbar
    Given I am logged in as the account "north-lead"
    When I visit the project "Template fixtures"
    And I click the tab "Templates"
    And I open the template "Web fixture template"
    And I click the tab "Settings"
    Then the "Description" field has a Markdown toolbar

  @nojs
  Scenario: Without JavaScript the description is a plain textarea that saves as typed
    Given a disposable review ticket assigned to "north-lead" with reviewer "north-guest"
    And I am logged in as the account "north-lead"
    When I visit the disposable review ticket
    And I follow the "More settings" action
    Then the "Description" field has no Markdown toolbar
    When I write "Edited without JavaScript" in the "Title" field
    And I write "**Plain** box\n\n- kept" in the "Description" field
    And I click button "Save"
    # A native form post sends a textarea's line breaks as CRLF (HTML form
    # encoding); the text itself is stored exactly as typed.
    Then the newest ticket titled "Edited without JavaScript" stores the description "**Plain** box\r\n\r\n- kept" in "bb_rich"
