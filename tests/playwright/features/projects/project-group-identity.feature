@functional @api
Feature: Projects, groups and workspaces carry a description and an image over JSON:API
  Both fields are native: `description` is a plain string of at most 280
  characters, `image` a single private raster file uploaded through core's
  JSON:API file-upload route. The existing entity access decides who may read
  or change either, and a private image is downloadable only by someone who
  may view the entity that references it. Every scenario starts by clearing
  both fields, so a failed run leaves nothing a rerun trips over.

  Scenario Outline: An editor sets, rejects and clears a <entity>'s description
    Given the <entity> "<fixture>" has no description and no image
    And the API client is "site-admin"
    When the API client sets the <entity> "<fixture>" description to 280 "é" characters
    Then the API response status is 200
    And the <entity> "<fixture>" description reads 280 "é" characters
    When the API client sets the <entity> "<fixture>" description to 281 "é" characters
    Then the API response status is 422
    And the <entity> "<fixture>" description reads 280 "é" characters
    When the API client sets the <entity> "<fixture>" description to "<script>alert(1)</script>"
    Then the API response status is 200
    And the <entity> "<fixture>" description reads "<script>alert(1)</script>"
    When the API client sets the <entity> "<fixture>" description to ""
    Then the API response status is 200
    And the <entity> "<fixture>" description is empty

    Examples:
      | entity    | fixture        |
      | project   | project.home   |
      | group     | group.home     |
      | workspace | workspace.home |

  Scenario Outline: An editor uploads, replaces and clears a <entity>'s image
    Given the <entity> "<fixture>" has no description and no image
    And the API client is "site-admin"
    When the API client uploads "avatar-wide.png" as the <entity> "<fixture>" image
    Then the API response status is 200
    And the <entity> "<fixture>" image is a private file
    And "site-admin" may download the <entity> "<fixture>" image
    And "north-contributor" may download the <entity> "<fixture>" image
    And "no-bakery" may not download the <entity> "<fixture>" image
    When the API client uploads a WebP as the <entity> "<fixture>" image
    Then the API response status is 200
    And the <entity> "<fixture>" image is a private file
    When the API client clears the <entity> "<fixture>" image
    Then the API response status is 200
    And the <entity> "<fixture>" has no image

    Examples:
      | entity    | fixture        |
      | project   | project.home   |
      | group     | group.home     |
      | workspace | workspace.home |

  Scenario Outline: A <entity> refuses <file> as its image
    Given the <entity> "<fixture>" has no description and no image
    And the API client is "site-admin"
    When the API client uploads <file> as the <entity> "<fixture>" image
    Then the API response status is 422
    And the <entity> "<fixture>" has no image

    Examples:
      | entity  | fixture      | file                        |
      | project | project.home | "not-an-image.png"          |
      | project | project.home | an SVG                      |
      | project | project.home | a PNG larger than 2 MB      |
      | group   | group.home   | "not-an-image.png"          |
      | group   | group.home   | an SVG                      |
      | group   | group.home   | a PNG larger than 2 MB      |
      | workspace | workspace.home | "not-an-image.png"      |
      | workspace | workspace.home | an SVG                  |

  Scenario Outline: Existing access decides who reads or changes a <entity>'s identity
    Given the <entity> "<fixture>" has no description and no image
    And the API client is "north-contributor"
    When the API client sets the <entity> "<fixture>" description to "Not yours to write"
    Then the API response is refused
    And the <entity> "<fixture>" description is empty
    When the API client uploads "avatar-wide.png" as the <entity> "<fixture>" image
    Then the API response is refused
    And the <entity> "<fixture>" has no image
    Given the API client is "no-bakery"
    When the API client reads the <entity> "<fixture>"
    Then the API response is refused

    Examples:
      | entity    | fixture        |
      | project   | project.home   |
      | group     | group.home     |
      | workspace | workspace.home |
