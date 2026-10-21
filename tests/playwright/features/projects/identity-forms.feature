@feature:identity-forms
Feature: Projects and groups get a description and an image in their forms
  The group create dialog and the project and group settings forms carry an
  optional plain-text Description (several lines; `\n` in a step is a line
  break) and an optional Image, with core's own upload, remove and
  validation. The listings show the result: the image (or initials) first on
  the left of the row, the description beneath the meta line, line breaks
  kept. Every scenario leaves the seeded world as it found it.

  Scenario: A group created with a description and an image shows both, then edits and clears them
    Given I am logged in as "Administrator"
    # create-b: group-team-create counts the groups of create-a in parallel.
    When I create a group in "create-b" with a description and the image "avatar-wide.png"
    Then the created group stores that description and an image
    And the "create-b" groups row of that group shows its image and description
    When I open that group's settings
    And I replace its description with "Edited once,\nthen reloaded." and remove its image
    And I reload that group's settings
    Then the settings form reads "Edited once,\nthen reloaded." and holds no image
    And the "create-b" groups row of that group shows its initials and "Edited once,\nthen reloaded."
    And at a phone width "/create-b/groups" does not scroll sideways

  Scenario: A project's settings set, refuse, replace and clear its identity
    Given I am logged in as "Administrator"
    # Not a project the listing-rows scenarios read, so the two can run in parallel.
    When I open the settings of the project "API sibling"
    Then the project form lists Teams after Group and groups the Repository
    And the project form offers Branch convention "yes"
    When I submit a 281 character description
    Then the form names the Description field's 280 character limit
    And the other settings fields kept their values
    When I set the description "Settings-set\ndescription." and upload "avatar-wide.png"
    And I reload the project's settings
    Then the settings form reads "Settings-set\ndescription." and holds an image
    When I upload "not-an-image.png" as the project image
    Then the upload is refused as not an image
    And the projects row of that project shows "Settings-set\ndescription."
    When I restore the project's seeded description and remove its image
    And I reload the project's settings
    Then the settings form reads the seeded description and holds no image

  # A workspace carries the same identity: set in its Settings, shown as the
  # switcher's mark and entries; its description appears on /home only.
  # "create-a" is a workspace no other scenario reads the switcher of.
  Scenario: A workspace's settings set its identity, and the switcher and chooser show it
    Given I am logged in as "Administrator"
    When I open the settings of the workspace "create-a"
    And I submit a 281 character description
    Then the form names the Description field's 280 character limit
    When I set the description "Where create-a\nships." and upload "avatar-wide.png"
    And I reload the workspace's settings
    Then the settings form reads "Where create-a\nships." and holds an image
    And the switcher of "create-a" shows its image
    And the switcher entry of "create-a" shows its image without "Where create-a\nships."
    And the chooser row of "create-a" shows its image and "Where create-a\nships."
    And at a phone width "/home" does not scroll sideways
    When I restore the workspace's seeded description and remove its image
    And I reload the workspace's settings
    Then the settings form reads the seeded description and holds no image
    And the switcher of "create-a" shows its initials

  # The create form renders the same settings display, so what it asks for
  # must reach the provisioned workspace. The workspace is removed afterwards.
  Scenario: A workspace created with a description and an image keeps both
    Given I am logged in as "Administrator"
    When I create a workspace with a description and the image "avatar-wide.png"
    Then the created workspace stores that description and an image
    And the switcher of that workspace shows its image
    And I delete that workspace

  # The identity fields add no access path of their own: the settings link,
  # the settings route and with them Description and Image reach exactly the
  # accounts whose rank may edit, and a create action only the accounts that
  # may create. Private image downloads per account are covered in
  # project-group-identity.feature. Read-only, so it runs beside the API suite.
  Scenario Outline: <account> reaches the <entity> identity fields only where its rank may edit
    Given I am logged in as the account "<account>"
    Then the <entity> settings at "<path>" are <settings> to me
    And the "<listing>" listing <listing_state>

    Examples:
      | account            | entity  | path                  | settings | listing             | listing_state                 |
      | api-lead           | group   | /api-home/group/API home | offered  | /api-home/groups    | offers "New group"            |
      | api-lead           | project | /api-home/project/apih |offered  | /api-home/projects  | offers "New project"          |
      | api-member         | group   | /api-home/group/API home | refused  | /api-home/groups    | offers "New group"            |
      | api-member         | project | /api-home/project/apih |refused  | /api-home/projects  | offers "New project"          |
      | api-workspace-only | group   | /api-home/group/API home | refused  | /api-home/groups    | is refused                    |
      | api-workspace-only | project | /api-home/project/apih |refused  | /api-home/projects  | is refused                    |
      | api-stranger       | group   | /api-home/group/API home | refused  | /api-home/groups    | is refused                    |
      | api-stranger       | project | /api-home/project/apih |refused  | /api-home/projects  | is refused                    |
