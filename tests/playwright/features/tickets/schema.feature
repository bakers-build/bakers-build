@functional @api
Feature: Public resource schemas
  Clients can discover the authoritative ticket write schema without receiving
  entity data or requiring a schema-specific permission.

  Scenario Outline: Ticket schema is available with and without an account
    Given the API client is "<account>"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/resource/schema"
    Then the API response status is 200
    And the response describes the ticket resource schema

    Examples:
      | account     |
      | anonymous   |
      | login-empty |
