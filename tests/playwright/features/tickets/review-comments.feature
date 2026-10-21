@functional @api
Feature: Ticket review comments stay private until accepted
  Assigned reviewers write unpublished drafts and submit them. The current
  assignee accepts or rejects. Acceptance publishes the same comment into the
  ordinary timeline; rejection and drafts stay off it.

  Background:
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    Given the session actor owns a running lease for ticket "ticket"
    And the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"assignee_user_id":{"data":{"type":"user--user","id":"{user.session}"}},"reviewers":{"data":[{"type":"user--user","id":"{user.session}"}]}}}}
      """
    Then the API response status is 200

  Scenario: A draft review is unpublished and stays off the comments include
    When the API client sends "POST" to "/jsonapi/bb_comment/review":
      """
      {"data":{"type":"bb_comment--review","attributes":{"body":{"value":"Private draft review body","format":"bb_rich"},"bb_comment_type":"comment"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "review"
    And the API client reads "/jsonapi/bb_comment/review/{saved.review}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":false,"review_state":"draft"}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments,pending_reviews"
    Then the API response status is 200
    And the API document excludes included resource "saved.review"
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[]},"pending_reviews":{"data":[]}}}}
      """

  Scenario: Submitting a draft does not publish it and queues it for the assignee
    When the API client sends "POST" to "/jsonapi/bb_comment/review":
      """
      {"data":{"type":"bb_comment--review","attributes":{"body":{"value":"Please accept this review","format":"bb_rich"},"bb_comment_type":"comment"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "review"
    And the API client sends "PATCH" to "/jsonapi/bb_comment/review/{saved.review}":
      """
      {"data":{"type":"bb_comment--review","id":"{saved.review}","attributes":{"review_state":"submitted"}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":false,"review_state":"submitted"}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments,pending_reviews"
    Then the API response status is 200
    And the API document includes resource "saved.review"
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[]},"pending_reviews":{"data":[{"type":"bb_comment--review","id":"{saved.review}"}]}}}}
      """

  Scenario: Accepting a submitted review publishes the same comment
    When the API client sends "POST" to "/jsonapi/bb_comment/review":
      """
      {"data":{"type":"bb_comment--review","attributes":{"body":{"value":"Accepted review body","format":"bb_rich"},"bb_comment_type":"comment"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "review"
    And the API client sends "PATCH" to "/jsonapi/bb_comment/review/{saved.review}":
      """
      {"data":{"type":"bb_comment--review","id":"{saved.review}","attributes":{"review_state":"submitted"}}}
      """
    Then the API response status is 200
    And the API client sends "PATCH" to "/jsonapi/bb_comment/review/{saved.review}":
      """
      {"data":{"type":"bb_comment--review","id":"{saved.review}","attributes":{"review_state":"accepted"}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":true,"review_state":"accepted"}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments,pending_reviews"
    Then the API response status is 200
    And the API document includes resource "saved.review"
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[{"type":"bb_comment--review","id":"{saved.review}"}]},"pending_reviews":{"data":[]}}}}
      """

  Scenario: Rejecting a submitted review keeps it unpublished
    When the API client sends "POST" to "/jsonapi/bb_comment/review":
      """
      {"data":{"type":"bb_comment--review","attributes":{"body":{"value":"Rejected review body","format":"bb_rich"},"bb_comment_type":"comment"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "review"
    And the API client sends "PATCH" to "/jsonapi/bb_comment/review/{saved.review}":
      """
      {"data":{"type":"bb_comment--review","id":"{saved.review}","attributes":{"review_state":"submitted"}}}
      """
    Then the API response status is 200
    And the API client sends "PATCH" to "/jsonapi/bb_comment/review/{saved.review}":
      """
      {"data":{"type":"bb_comment--review","id":"{saved.review}","attributes":{"review_state":"rejected"}}}
      """
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"status":false,"review_state":"rejected"}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=comments,pending_reviews"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"relationships":{"comments":{"data":[]},"pending_reviews":{"data":[]}}}}
      """
    Given the API client is "anonymous"
    When the API client reads "/jsonapi/bb_comment/review/{saved.review}"
    Then the API response status is 401

  Scenario: Creating a review as accepted is rejected
    When the API client sends "POST" to "/jsonapi/bb_comment/review":
      """
      {"data":{"type":"bb_comment--review","attributes":{"body":{"value":"Forged accepted review","format":"bb_rich"},"bb_comment_type":"comment","review_state":"accepted","status":true},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 403

  Scenario: The review resource schema is discoverable
    When the API client reads "/jsonapi/bb_comment/review/resource/schema"
    Then the API response status is 200

  Scenario: A foreign account cannot be made a reviewer
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","relationships":{"reviewers":{"data":[{"type":"user--user","id":"{user.foreign}"}]}}}}
      """
    Then the API response status is 422
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API document contains:
      """
      {"data":{"relationships":{"reviewers":{"data":[{"type":"user--user","id":"{user.session}"}]}}}}
      """

  Scenario: Anonymous and foreign readers get no reviewers
    Given the API client is "anonymous"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=reviewers"
    Then the API response status is 401
    Given the API client is "api-foreign"
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}?include=reviewers"
    Then the API response status is 403
