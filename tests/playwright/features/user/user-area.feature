# BB-529 — the user area is split back into two distinct routes: `/edit`
# (the settings form) and `/user/{user}` (Drupal's own view builder, no tab
# row, no connections surface). No island governs this area — it is an
# ordinary entity form and an ordinary entity view, so the browser evidence
# here is about the FIELDS, the LOCK, and the route split, not about a
# client-side swap. Every navigating scenario still clicks twice, matching the
# suite's own convention.

Feature: The user area is split into a view route and an edit route

  Background:
    Given I am logged in as the account "north-lead"

  Scenario: Full name saves and survives a reload
    When I visit my profile settings
    And I fill in the full name "Ada Lovelace"
    And I save the profile form
    And I reload the page
    Then the full name field holds "Ada Lovelace"

  # Platform usernames, the activity and depth questions and the Social Auth
  # widget were removed; their controls must be absent, not merely unlabelled.
  # Reached through a boosted tab link, the form's action used to carry the
  # htmx request's ajax_page_state; Save's redirect repeated it and the page
  # came back without its stylesheets.
  Scenario: Saving the profile reached through its tab keeps the page styled
    When I visit my user area
    And I click the tab "Edit"
    And I save the profile form
    Then the page is styled by the theme
    When I click the tab "View"
    And I click the tab "Edit"
    And I save the profile form
    Then the page is styled by the theme

  Scenario: The edit form shows none of the removed account items
    When I visit my profile settings
    Then the profile form has no retired account fields

  Scenario: A linked account sees its mail locked with a provenance note
    Given the account "north-lead" is linked to an oauth provider
    When I visit my profile settings
    Then the mail field is disabled
    And the mail field's description names the provider

  Scenario: An unlinked account can still change its mail address
    Given the account "north-lead" is not linked to an oauth provider
    When I visit my profile settings
    Then the mail field is not disabled

  Scenario: The view route is not the edit form
    When I visit my user area
    And I visit my user area
    Then the page has no profile form

  # The overview is the account's identity (`user.full`), and the header's
  # View and Edit links are core's local tasks. Both clicks are real header
  # links, so the second one proves the first left a working shell behind.
  Scenario: View and Edit keep the shell and show the same account
    Given the account "north-lead" has full name "Ada Lovelace" and developer title "Backend engineer"
    When I visit my user area
    Then the user overview shows the name "Ada Lovelace" and the developer title "Backend engineer"
    And the user overview does not disclose the mail of "north-lead"
    When I click "Edit" in the page header
    Then I am on the edit route of "north-lead"
    And the profile form is inside the app shell
    When I click "View" in the page header
    Then I am on the canonical route of "north-lead"
    And the user overview shows the name "Ada Lovelace" and the developer title "Backend engineer"
    And the page has no profile form

  # Core's View and Edit tasks render through the same tab-row templates as the
  # project and team rows, so they carry the same current-page marker and fit a
  # narrow viewport the same way.
  Scenario: View and Edit fit a narrow viewport and mark the current page
    When I view the page 320 pixels wide
    And I visit my user area
    Then every tab fits within the viewport
    And exactly one tab is marked as the current page
    When I click "Edit" in the page header
    Then I am on the edit route of "north-lead"
    And exactly one tab is marked as the current page
    When I click "View" in the page header
    Then I am on the canonical route of "north-lead"
    And exactly one tab is marked as the current page
    And every tab fits within the viewport

  Scenario: The edit form stays in the shell on a direct load and a reload
    When I visit my profile settings
    Then the profile form is inside the app shell
    When I reload the page
    Then the profile form is inside the app shell

  # An administrator holds `view the administration theme`; the edit route
  # must not fall back to the admin theme for them either.
  Scenario: An administrator's account edit keeps the shell
    Given I am logged in as the account "site-admin"
    When I visit the user area of "site-admin"
    And I click "Edit" in the page header
    Then I am on the edit route of "site-admin"
    And the profile form is inside the app shell
    When I reload the page
    Then the profile form is inside the app shell
    When I click "View" in the page header
    Then I am on the canonical route of "site-admin"

  Scenario: An account without a full name or title falls back to its name
    Given the account "no-bakery" has no full name and no developer title
    And I am logged in as the account "no-bakery"
    When I visit the user area of "no-bakery"
    Then the user overview shows the name "no-bakery" and no developer title

  Scenario: An administrator viewing another account sees that account
    Given the account "north-lead" has full name "Ada Lovelace" and developer title "Backend engineer"
    And I am logged in as the account "site-admin"
    When I visit the user area of "north-lead"
    Then the user overview shows the name "Ada Lovelace" and the developer title "Backend engineer"

  Scenario: Another account's view and edit routes are denied
    Then the view and edit routes of "north-member" are denied to me

  Scenario: The edit form offers no password
    When I visit my profile settings
    Then the page has no password field
