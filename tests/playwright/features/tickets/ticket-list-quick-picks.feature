@feature:ticket-list-quick-picks
Feature: A facet pick made while the previous one is still loading is kept
  A facet pick submits the exposed form as a boosted GET. A second pick made
  before the first answer arrives must not be lost: the list and the address
  end up carrying both picks.

  Scenario: Two quick picks in one facet both apply
    Given I am signed in as a member of the "bakers" workspace
    And list requests answer slowly
    When I visit the full ticket list of the "bakers" workspace
    And I click "Working" and then "Review" in the "State" facet without waiting
    Then the address carries "state[]=working"
    And the address carries "state[]=review"
    And the active filters read "State is either of Working, Review"


  Scenario: A sort change made while a facet pick loads keeps both after a reload
    Given I am signed in as a member of the "bakers" workspace
    And list requests answer slowly
    When I visit the tickets tab of project "bakers.build Platform"
    And I click "Working" in the "State" facet and then sort by "identifier_ASC" without waiting
    Then the address carries "state[]=working"
    And the address carries "sort_bef_combine=identifier_ASC"
    And no facet says "Not saved."
    When I reload the ticket list
    Then the "State" facet shows "Working" as chosen
    And the sort dropdown still reads "identifier_ASC"
