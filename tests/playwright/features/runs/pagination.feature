@functional @api @pagination-contract
Feature: Run collection access before pagination
  Twenty-five owned runs and ten foreign runs distinguish a full page from
  post-load omission, and the total must disclose only accessible rows.

  Background:
    Given the pagination accounts have only their ordinary workspace memberships

  Scenario: A full first page has no omitted rows and an access-filtered count
    Given the API client is "api-pagination-home"
    When the API client reads "/jsonapi/bb_run/bb_run?page[limit]=20&sort=drupal_internal__id"
    Then the API response status is 200
    And the API collection has 20 rows and reports total 25

  Scenario: Consecutive pages skip and duplicate nothing
    Given the API client is "api-pagination-home"
    Then walking both run pages yields exactly the 25 owned fixtures

  Scenario: A filtered read still returns a full page
    Given the API client is "api-pagination-home"
    When the API client reads "/jsonapi/bb_run/bb_run?filter[closed]=0&page[limit]=20"
    Then the API response status is 200
    And the API collection has 20 rows and reports total 25

  Scenario: An account without run access learns neither rows nor their count
    Given the API client is "api-stranger"
    When the API client reads "/jsonapi/bb_run/bb_run?page[limit]=20"
    Then the API response status is 200
    And the API collection has 0 rows and reports total 0
