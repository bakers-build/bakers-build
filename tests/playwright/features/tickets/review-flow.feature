@feature:review-flow
Feature: Reviewers write private reviews the assignee publishes
  The ticket sidebar holds a Reviews block above Properties. An assigned
  reviewer writes a review from it in a dialog. Every review the viewer may
  see is listed there compactly, as its author and its state widget: the
  current state plus only the transitions this viewer may perform. A draft
  stays with its author and is editable. Submitting hands it to the current
  assignee, who accepts it into the ticket's handoff stream or rejects it.
  Other readers see a review only once it is accepted, and see no block
  before that. Being a reviewer grants no right to change the ticket. Every
  scenario works on its own disposable ticket in the seeded workspace: the
  assignee is "cwiedemann", the reviewer is the read-only guest
  "addon-reviewer", and "bakers-e2e-agent" is an ordinary reader of the same
  workspace.

  Background:
    Given a disposable review ticket assigned to "cwiedemann" with reviewer "addon-reviewer"

  Scenario: A draft stays with its author, editable, until submitted
    Given I am logged in as the account "addon-reviewer"
    When I visit the disposable review ticket
    Then the Reviews block sits above Properties
    And no review surface is left in the main column
    When I write the review "Chips lose focus" and save it as a draft
    Then the review dialog is closed
    And the Reviews block lists a "Draft" review by "addon-reviewer" offering "Submit"
    Given I am logged in as the account "cwiedemann"
    When I visit the disposable review ticket
    Then I see no Reviews block
    And I do not see the review "Chips lose focus"
    Given I am logged in as the account "addon-reviewer"
    When I visit the disposable review ticket
    And I change my draft review to "Chips lose focus after Save" and submit it
    Then the review dialog is closed
    And the Reviews block lists a "Submitted" review by "addon-reviewer" offering nothing
    And the review by "addon-reviewer" offers no edit

  Scenario: Submitting a draft from its state widget
    Given I am logged in as the account "addon-reviewer"
    When I visit the disposable review ticket
    And I write the review "Submit from the widget" and save it as a draft
    And I press "Submit" on the review by "addon-reviewer"
    Then the Reviews block lists a "Submitted" review by "addon-reviewer" offering nothing

  Scenario: Accepting publishes the review to every reader
    Given "addon-reviewer" submitted the review "Ship it with the empty state"
    And I am logged in as the account "bakers-e2e-agent"
    When I visit the disposable review ticket
    Then I see no Reviews block
    And I do not see the review "Ship it with the empty state"
    Given I am logged in as the account "cwiedemann"
    When I visit the disposable review ticket
    Then the Reviews block lists a "Submitted" review by "addon-reviewer" offering "Accept, Reject"
    When I press "Accept" on the review by "addon-reviewer"
    Then the Reviews block lists a "Accepted" review by "addon-reviewer" offering nothing
    Given I am logged in as the account "bakers-e2e-agent"
    When I visit the disposable review ticket
    Then the Reviews block lists a "Accepted" review by "addon-reviewer" offering nothing
    And the handoff stream shows the review "Ship it with the empty state"

  Scenario: Rejecting keeps the review private to its author
    Given "addon-reviewer" submitted the review "Rename every variable"
    And I am logged in as the account "cwiedemann"
    When I visit the disposable review ticket
    And I press "Reject" on the review by "addon-reviewer"
    Then the Reviews block lists a "Rejected" review by "addon-reviewer" offering nothing
    Given I am logged in as the account "bakers-e2e-agent"
    When I visit the disposable review ticket
    Then I see no Reviews block
    And I do not see the review "Rename every variable"
    Given I am logged in as the account "addon-reviewer"
    When I visit the disposable review ticket
    Then the Reviews block lists a "Rejected" review by "addon-reviewer" offering nothing

  Scenario: A user of another workspace cannot reach the ticket or its reviews
    Given "addon-reviewer" submitted the review "Foreign eyes only"
    And I am logged in as the account "other-member"
    When I visit the disposable review ticket
    Then the disposable review ticket answers 403 without the review "Foreign eyes only"

  Scenario: Saving yourself as a reviewer offers Write a review without a manual reload
    Given I am logged in as the account "cwiedemann"
    When I visit the disposable review ticket
    Then I am not offered "Write a review"
    When I select inline "Reviewers" option "cwiedemann"
    And I save the inline properties
    Then I am offered "Write a review" without leaving the page

  Scenario: Reviewer assignment grants no authority over the ticket
    Given I am logged in as the account "addon-reviewer"
    When I visit the disposable review ticket
    Then the Properties block offers no Save
    And I am offered "Write a review"
    When "addon-reviewer" tries to clear the reviewers of the disposable review ticket over JSON:API
    Then that write is refused with status 403
    And the disposable review ticket still has the reviewer "addon-reviewer"
