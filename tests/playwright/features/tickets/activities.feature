@functional @api
Feature: Ticket activity JSON:API contract
  Ticket creation, committed status changes, the first work claim of a ticket
  and runs that end failed, expired or cancelled persist as bb_activity rows.
  Reads follow ticket access. Clients cannot write activities.

  Scenario: Creating a ticket records one created activity
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    And exactly one created activity records state "qualification" by user "user.member"
    And the activity collection has 0 status_changed rows

  Scenario: Activity persists for an accepted status write
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&sort=-drupal_internal__id"
    Then the API response status is 200
    And exactly one status_changed activity records "qualification" to "spec"
    And its actor is user "user.member"
    When the API client remembers the activity collection ids as "first-read"
    And the API client changes ticket "ticket" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&sort=-drupal_internal__id"
    Then the API response status is 200
    And the activity collection ids match "first-read"

  Scenario: A rejected transition adds no activity
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "done"
    Then the API response status is 422
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=status_changed"
    Then the API response status is 200
    And the API collection is empty

  Scenario: Ticket and project filters narrow already-authorized rows
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "one"
    And the API client changes ticket "one" to state "spec"
    And the API client creates a "bb_feature" ticket in "home" as "two"
    And the API client changes ticket "two" to state "spec"
    And the API client creates a "bb_feature" ticket in "sibling" as "sibling"
    And the API client changes ticket "sibling" to state "spec"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.one}&sort=-drupal_internal__id"
    Then the API response status is 200
    And the activity collection ticket ids are only "one"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.project_id.id]={project.home}&page[limit]=50"
    Then the API response status is 200
    And the activity collection includes tickets "one" and "two"
    And the activity collection excludes tickets "sibling" and fixture "ticket.other"

  Scenario: A successful claim records one claimed activity
    Given the API client is "login-admin"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-activity-{saved.ticket}","label":"BDD activity claim","states":["diagnose"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.conductor-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"diagnose","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    Given the API client is "api-conductor-owner"
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-{saved.ticket}","lease_seconds":600}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "run"
    When the API client sends "PATCH" to "/jsonapi/bb_run/bb_run/{saved.run}":
      """
      {"data":{"type":"bb_run--bb_run","id":"{saved.run}","attributes":{"state":"running"}}}
      """
    Then the API response status is 200
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-{saved.ticket}","lease_seconds":600}}}
      """
    Then the API response status is 409
    Given the API client is "login-admin"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=claimed&include=run_id,conductor_id,actor"
    Then the API response status is 200
    And exactly one claimed activity matches run "run" conductor "conductor" step "diagnose" actor "user.conductor-owner"
    And the API document includes resource "saved.run"
    And the activity collection has 1 claimed row
    Given the API client is "api-member"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=claimed&include=run_id,conductor_id,actor"
    Then the API response status is 200
    And the claimed activity omits inaccessible related identities
    And the API document excludes included resource "user.conductor-owner"

  Scenario: A later claim of the same ticket adds no claimed activity
    Given the API client is "login-admin"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-activity-later-{saved.ticket}","label":"BDD later claim","states":["diagnose"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.conductor-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"diagnose","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    Given the API client is "api-conductor-owner"
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-later-{saved.ticket}","lease_seconds":600}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "first-run"
    When the API client sends "PATCH" to "/jsonapi/bb_run/bb_run/{saved.first-run}":
      """
      {"data":{"type":"bb_run--bb_run","id":"{saved.first-run}","attributes":{"state":"done"}}}
      """
    Then the API response status is 200
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-later-{saved.ticket}","lease_seconds":600}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "second-run"
    Given the API client is "login-admin"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=claimed&sort=-drupal_internal__id"
    Then the API response status is 200
    And the activity collection has 1 claimed row
    And exactly one claimed activity references run "first-run" at step "diagnose"

  Scenario: A run that fails without moving the ticket records run_ended
    Given the API client is "login-admin"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-activity-failed-{saved.ticket}","label":"BDD failed run","states":["diagnose"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.conductor-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"diagnose","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    Given the API client is "api-conductor-owner"
    When the API client sends "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim":
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-failed-{saved.ticket}","lease_seconds":600}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "run"
    When the API client sends "PATCH" to "/jsonapi/bb_run/bb_run/{saved.run}":
      """
      {"data":{"type":"bb_run--bb_run","id":"{saved.run}","attributes":{"state":"failed","error_log":"setup failed"}}}
      """
    Then the API response status is 200
    Given the API client is "login-admin"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=run_ended"
    Then the API response status is 200
    And exactly one run_ended activity references run "run" at step "diagnose"

  Scenario: Two simultaneous claims yield one success and one conflict
    Given the API client is "login-admin"
    When the API client creates a "bb_bug" ticket in "home" as "ticket"
    When the API client sends "POST" to "/jsonapi/bb_conductor/bb_conductor":
      """
      {"data":{"type":"bb_conductor--bb_conductor","attributes":{"conductor_id":"bdd-activity-race-{saved.ticket}","label":"BDD race claim","states":["diagnose"],"status":"online"},"relationships":{"project_id":{"data":{"type":"bb_project--bb_project","id":"{project.home}"}},"owner_user_id":{"data":{"type":"user--user","id":"{user.conductor-owner}"}}}}}
      """
    Then the API response status is 201
    When the API resource is remembered as "conductor"
    When the API client sends "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}":
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"diagnose","priority":1},"relationships":{"conductor_id":{"data":{"type":"bb_conductor--bb_conductor","id":"{saved.conductor}"}}}}}
      """
    Then the API response status is 200
    When two API clients "api-conductor-owner" send "POST" to "/jsonapi/bb_ticket/{saved.ticket}/claim" at once:
      """
      {"data":{"type":"bakers-claim","attributes":{"conductor_id":"bdd-activity-race-{saved.ticket}","lease_seconds":600}}}
      """
    Then the concurrent responses are 201 and 409
    Given the API client is "login-admin"
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=claimed"
    Then the API response status is 200
    And the activity collection has 1 claimed row

  Scenario: Two simultaneous status writes serialize predecessor and final state
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    When two API clients "api-member" send "PATCH" to "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}" at once:
      """
      {"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}","attributes":{"state":"spec"}}}
      """
    When the API client reads "/jsonapi/bb_ticket/bb_ticket/{saved.ticket}"
    Then the API response status is 200
    And the API document contains:
      """
      {"data":{"attributes":{"state":"spec"}}}
      """
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&filter[kind]=status_changed"
    Then the API response status is 200
    And exactly one status_changed activity records "qualification" to "spec"

  Scenario: Activities of one ticket page without collapsing and sort by descending id
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client bounces ticket "ticket" between spec and qualification 21 times
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}&sort=-drupal_internal__id&page[limit]=20"
    Then the API response status is 200
    And the API collection has 20 rows and reports total 22
    And the activity collection is sorted by descending internal id
    When walking both activity pages of ticket "ticket" yields 22 rows
    Then those pages skip and duplicate nothing

  Scenario: Clients cannot create update or delete activities
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    When the API collection row 0 is remembered as "activity"
    When the API client sends "POST" to "/jsonapi/bb_activity/bb_activity":
      """
      {"data":{"type":"bb_activity--bb_activity","attributes":{"kind":"status_changed"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 403
    When the API client sends "PATCH" to "/jsonapi/bb_activity/bb_activity/{saved.activity}":
      """
      {"data":{"type":"bb_activity--bb_activity","id":"{saved.activity}","attributes":{"kind":"claimed"}}}
      """
    Then the API response status is 403
    When the API client sends "DELETE" to "/jsonapi/bb_activity/bb_activity/{saved.activity}":
      """
      {}
      """
    Then the API response status is 403
    Given the API client is "login-admin"
    When the API client sends "POST" to "/jsonapi/bb_activity/bb_activity":
      """
      {"data":{"type":"bb_activity--bb_activity","attributes":{"kind":"status_changed"},"relationships":{"ticket_id":{"data":{"type":"bb_ticket--bb_ticket","id":"{saved.ticket}"}}}}}
      """
    Then the API response status is 403
    When the API client sends "DELETE" to "/jsonapi/bb_activity/bb_activity/{saved.activity}":
      """
      {}
      """
    Then the API response status is 403

  Scenario: A foreign member cannot read another workspace's activities
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    When the API collection row 0 is remembered as "activity"
    Given the API client is "other-member"
    When the API client reads "/jsonapi/bb_activity/bb_activity/{saved.activity}"
    Then the API response status is 403
    When the API client reads "/jsonapi/bb_activity/bb_activity/{saved.activity}?include=actor,run_id,conductor_id"
    Then the API response status is 403
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    And the API collection is empty
    When the API client reads "/jsonapi/bb_activity/bb_activity"
    Then the API response status is 200
    And the activity collection excludes resource "activity"
    Given the API client is "api-foreign"
    When the API client creates a "bb_feature" ticket in "other" as "theirs"
    And the API client changes ticket "theirs" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.theirs}"
    Then the API response status is 200
    And the activity collection ticket ids are only "theirs"
    When the API client reads "/jsonapi/bb_activity/bb_activity/{saved.activity}"
    Then the API response status is 403

  Scenario: Anonymous cannot read a persisted activity
    Given the API client is "api-member"
    When the API client creates a "bb_feature" ticket in "home" as "ticket"
    And the API client changes ticket "ticket" to state "spec"
    Then the API response status is 200
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    When the API collection row 0 is remembered as "activity"
    Given the API client is "anonymous"
    When the API client reads "/jsonapi/bb_activity/bb_activity/{saved.activity}"
    Then the API response status is 401
    When the API client reads "/jsonapi/bb_activity/bb_activity?filter[ticket_id.id]={saved.ticket}"
    Then the API response status is 200
    And the API collection is empty
