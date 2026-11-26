@feature:project-identifier-prefix
Feature: A project editor changes the identifier prefix
  The identifier prefix (`key`) starts every ticket identifier. A lead changes
  it on the project's Settings form; existing tickets keep their identifier and
  only tickets created afterwards use the new prefix. A prefix another
  project's tickets still carry is reserved. Each scenario works on disposable
  projects and deletes them afterwards.

  Scenario: A lead changes the prefix; old tickets keep theirs, new ones use it
    Given a disposable project with one ticket
    And another project's ticket carries a retired prefix
    And I am logged in as the account "north-lead"
    When I open the disposable project's settings
    Then the field "Identifier prefix" holds the project's prefix
    When I save the identifier prefix "old1"
    Then the form names the identifier prefix rule
    And the project's prefix is unchanged
    When I save the retired prefix
    Then the form says the retired prefix is reserved
    And the project's prefix is unchanged
    When I save a new identifier prefix
    Then the project's prefix is the new one
    And the existing ticket still opens under its old identifier
    And the next ticket of the project gets the new prefix and the next number

  Scenario: A guest cannot change the prefix
    Given a disposable project with one ticket
    And I am logged in as the account "north-guest"
    Then the disposable project's settings refuse me
