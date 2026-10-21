@functional @browser-contract
Feature: Review draft form on the ticket page
  An assigned reviewer finds Write a review on the ticket page, and the draft
  form offers Save draft and Submit review without exposing state or
  publication fields.

  Scenario: An assigned reviewer finds Write a review and a draft-only form
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    Given the session actor owns a running lease for ticket "ticket"
    And the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"assignee_user_id":{"data":{"type":"user--user","id":"{user.member}"}},"reviewers":{"data":[{"type":"user--user","id":"{user.member}"}]}}}}
      """
    Then the API response status is 200
    Given the browser uses recipe account "member"
    When the contract browser opens "/api-home/ticket/{saved.ticket}" with status 200
    Then the contract page contains "Write a review"
    When the contract browser opens "/api-home/ticket/{saved.ticket}/review/add" with status 200
    Then the contract page contains "Save draft"
    And the contract page contains "Submit review"
    And the contract field "review_state[0][value]" is absent
    And the contract field "status[value]" is absent
