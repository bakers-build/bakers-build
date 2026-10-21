@feature:projects-list
Feature: Groups and Projects are separate workspace listings
  Each listing is an ordinary Views page with its own search toolbar. The rail
  is an island whose swap target is the shell content container, so every
  navigating scenario still clicks TWICE: a declaration lost in a swap
  survives the first click.

  @shell
  Scenario: The Projects listing renders inside the application shell
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    Then the application shell is present
    And the shell rail is present
    And the page heading is "Projects"
    And only the "Projects" listing is visible
    And the rail lists "My work", "Groups" and "Projects" before the "Teams" heading
    And the rail lists "Groups", "Projects" and "Settings" before the "Teams" heading

  Scenario: The Groups listing states that a group grants no permissions
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Groups" listing
    Then only the "Groups" listing is visible
    And the Groups listing shows "A group grants no permissions"

  Scenario: Each listing renders rows of the workspace's own data
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    Then the "Projects" list has at least 1 row
    And no "Projects" row shows a project key
    When I visit the "Groups" listing
    Then the "Groups" list has at least 1 row

  Scenario Outline: A search belongs to its own workspace listing
    Given I am logged in as a member of the listing fixture workspace
    When I open the "<listing>" rail entry
    Then only the "<listing>" listing is visible
    And the search toolbar is above its list
    When I search the listing for "Alpha"
    Then matching Alpha rows are visible and Beta rows are absent
    And matching rows from the other workspace are absent
    When I search the listing for "no-such-listing-title"
    Then the empty result and the search field remain visible
    When I clear the search and submit
    Then the original accessible rows return
    Examples:
      | listing  |
      | Groups   |
      | Projects |

  Scenario Outline: A full page load and a rail click frame a listing the same way
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "<listing>" listing
    Then the listing sits in a single content frame
    When I open the "<listing>" rail entry
    Then the list edge has not moved since the last frame check
    And the listing sits in a single content frame
    Examples:
      | listing  |
      | Groups   |
      | Projects |

  Scenario: Navigating Groups, Projects, then Groups does not reload the page
    Given I am signed in as a member of the "bakers" workspace
    And I visit the team "Platform Crew"
    When I click the rail entry "Groups"
    Then the document was not reloaded
    And the address ends with "/groups"
    And the rail marks "Groups" as current
    When I click the rail entry "Projects"
    Then the document was not reloaded
    And the address ends with "/projects"
    And the rail marks "Projects" as current
    When I click the rail entry "Groups"
    Then the document was not reloaded
    And the address ends with "/groups"
    And the rail marks "Groups" as current

  Scenario: A search survives reload
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Groups" listing
    And I search the listing for "Alpha"
    Then the address carries "title=Alpha"
    When I reload the listing
    Then matching Alpha rows are visible and Beta rows are absent
    And the search field still reads "Alpha"

  Scenario: A rail click after searching keeps the document
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Groups" listing
    And I search the listing for "Alpha"
    When I click the rail entry "Projects"
    Then the document was not reloaded
    And the address ends with "/projects"
    And the rail marks "Projects" as current
    And only the "Projects" listing is visible

  Scenario: A direct visit renders the whole page
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    Then the application shell is present
    And the shell rail is present
    And the "Projects" listing is present
    And the "Projects" list has at least 1 row
    When I visit the "Groups" listing
    Then the "Groups" listing is present
    And the "Groups" list has at least 1 row

  @negative-control
  Scenario: The document detector really does see a full page load
    Given I am signed in as a member of the "bakers" workspace
    When I visit the "Projects" listing
    And I reload the listing
    Then the document was reloaded

  Scenario: A member of another workspace is refused
    Given I am signed in as a member of the "other" workspace
    When I visit the "Projects" listing of the "bakers" workspace
    Then the listing is refused
    When I visit the "Groups" listing of the "bakers" workspace
    Then the listing is refused
