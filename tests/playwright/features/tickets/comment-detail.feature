@feature:comment-detail
Feature: A comment has a ticket-framed canonical page
  Handoff comments open as their own page in the workspace shell. The ticket
  summary and handoff stream stay compact teasers with a canonical link.
  Previous and next stay on the same ticket. A long Markdown body keeps its
  trailing marker.

  Background:
    Given I am signed in as a member of the "bakers" workspace

  Scenario: Read a handoff and return to its ticket
    Given a disposable "bb_feature" ticket in state "coding"
    And the disposable ticket has a spec handoff whose body contains a table and "BB-657-END-MARKER"
    When I visit the disposable ticket
    And I open the handoff stream
    And I open the comment link "Open spec comment"
    Then the application shell is present
    And exactly one canvas is present in the document
    And a breadcrumb trail is present
    And the page heading is "Open spec comment"
    And the page shows "BB-657-END-MARKER"
    And the page shows a table cell "Cell"
    And the page shows "spec"
    And the page shows the comment author
    And the page shows the comment time
    And the page shows the disposable ticket identifier
    And the page shows "coding"
    When I go back
    And I open the handoff stream
    And I open the comment link "Open spec comment"
    Then the page shows "BB-657-END-MARKER"
    And the document was not reloaded
    When I open the disposable ticket identifier
    Then the page heading is the disposable ticket title
    When I open the handoff stream
    Then the page shows "Open spec comment"

  Scenario: Browse only this ticket's visible comments
    Given a disposable "bb_feature" ticket in state "coding"
    And the disposable ticket has older spec, current plan and newer test comments
    And another ticket has a comment between those times
    When I visit the current comment
    And I open the comment link "Previous: spec"
    Then the page shows "OLDER-SPEC-BODY"
    And the page does not show "FOREIGN-COMMENT-BODY"
    When I open the comment link "Next: plan"
    Then the page shows "CURRENT-PLAN-BODY"
    When I open the comment link "Previous: spec"
    Then the page shows "OLDER-SPEC-BODY"
    And the document was not reloaded

  Scenario: Read through a long handoff
    Given a disposable "bb_feature" ticket in state "coding"
    And the disposable ticket has a 32 KiB handoff-v3 body ending with "BB-657-END-MARKER"
    When I visit that long comment
    Then the page heading is "Open handoff-v3 comment"
    And the page shows "handoff-v3"
    And the page shows "BB-657-END-MARKER"
    And the page shows a table cell "Wide"

  @nojs
  Scenario: The handoff canonical link works with JavaScript disabled
    Given a disposable "bb_feature" ticket in state "coding"
    And the disposable ticket has a spec handoff whose body contains a table and "BB-657-END-MARKER"
    When I visit the disposable ticket
    And I open the handoff stream
    And I open the comment link "Open spec comment"
    Then the page shows "BB-657-END-MARKER"
    And the application shell is present
    And the page shows a table cell "Cell"
