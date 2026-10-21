# Projects, groups and workspaces crop their image where it is uploaded, with
# the dialog the profile picture uses, and every identity surface shows the
# saved square. Every scenario creates its own subject through the UI and
# deletes it afterwards, so it runs beside the identity-forms scenarios that
# edit seeded subjects. Pixels are read from the rendered <img> after a reload;
# no step writes the hidden crop value. The fixture is red on the left, grey in
# the middle (the centred default) and blue with a yellow disc on the right.
#
# Subjects: a project in "bakers" (it needs that workspace's group and team), a
# group in "create-b" (group-team-create counts the groups of "create-a"), and
# a workspace its own non-administrator owner creates.
@feature:entity-identity-crop
Feature: Cropped images and visible descriptions identify projects, groups and workspaces

  # AC-1, AC-4, AC-6. The create form stages one crop, the settings form a
  # second one of the same file; both reach every surface without a cache
  # clear. The description carries literal markup, which must read as text.
  Scenario Outline: A <entity> crop chosen in its create form and changed in its settings reaches its identity surfaces
    Given I am logged in as the <entity> creator
    When I open the <entity> create form
    And I enter a <entity> name and the description "Ships <b>fast</b> & well."
    And I choose the image "avatar-wide.png" in the <entity> form
    And I drag the image in the crop dialog 400 pixels to the right
    Then the image in the crop dialog has moved
    When I apply the crop
    And I submit the <entity> form
    Then every identity image of the <entity> shows "red"
    And every description surface of the <entity> reads "Ships <b>fast</b> & well."
    And the <entity> identity surfaces fit a screen 320 pixels wide
    When I open the <entity> settings form
    And I edit the crop of the <entity> image
    And I drag the image in the crop dialog 800 pixels to the left
    And I apply the crop
    And I submit the <entity> form
    Then every identity image of the <entity> shows "yellow"
    And I delete the <entity>

    Examples:
      | entity    |
      | project   |
      | group     |
      | workspace |

  # AC-2. The crop dialog sits in the top layer above the project and group
  # create dialogs; dismissing it must leave that parent, its input and the
  # staged file alone. Workspace creation is a page form, kept the same way.
  Scenario Outline: <action> in the crop dialog closes only the crop dialog of a new <entity>
    Given I am logged in as the <entity> creator
    When I open the <entity> create form
    And I enter a <entity> name and the description "Kept while cropping."
    And I choose the image "avatar-wide.png" in the <entity> form
    And I drag the image in the crop dialog 400 pixels to the right
    And I dismiss the crop dialog with <action>
    Then only the crop dialog closed and Edit crop has focus
    And the <entity> form still holds its name, description and image
    When I submit the <entity> form
    Then every identity image of the <entity> shows "grey"
    And I delete the <entity>

    Examples:
      | entity    | action |
      | project   | Escape |
      | project   | Cancel |
      | group     | Escape |
      | group     | Cancel |
      | workspace | Escape |
      | workspace | Cancel |

  # AC-3. The derivative URL is no capability: an outsider is refused both the
  # original and the crop, before the crop is generated and after a member
  # has generated it.
  Scenario Outline: A <entity>'s private image and its crop stay with the people who may see the <entity>
    Given I am logged in as the <entity> creator
    And I have created a <entity> with a cropped image
    And its crop has not been generated yet
    Then anonymous visitors and "api-stranger" cannot read its image or its crop
    And its crop is still not generated
    And its <member> can read its image and its crop
    And anonymous visitors and "api-stranger" cannot read its image or its crop
    And I delete the <entity>

    Examples:
      | entity    | member                |
      | project   | member "cwiedemann"   |
      | group     | member "create-owner" |
      | workspace | owner                 |

  # Review focus: a refused form keeps the saved crop, a cancelled edit keeps
  # it too, a replacement starts from its own centred square, and removing the
  # image falls back to the initials.
  Scenario Outline: A refused, cancelled, replaced or removed <entity> image keeps the right identity
    Given I am logged in as the <entity> creator
    And I have created a <entity> with a cropped image
    When I open the <entity> settings form
    And I edit the crop of the <entity> image
    And I drag the image in the crop dialog 800 pixels to the left
    And I apply the crop
    And I clear the <entity> name and submit the <entity> form
    Then the <entity> form refuses the empty name
    And every identity image of the <entity> shows "red"
    When I open the <entity> settings form
    And I edit the crop of the <entity> image
    And I drag the image in the crop dialog 800 pixels to the left
    And I dismiss the crop dialog with Cancel
    And I submit the <entity> form
    Then every identity image of the <entity> shows "red"
    When I open the <entity> settings form
    And I remove the <entity> image
    And I choose the image "avatar-tall.png" in the <entity> form
    And I apply the crop
    And I submit the <entity> form
    Then every identity image of the <entity> shows "grey"
    When I open the <entity> settings form
    And I remove the <entity> image
    And I submit the <entity> form
    Then every identity surface of the <entity> shows its initials
    And I delete the <entity>

    Examples:
      | entity    |
      | project   |
      | group     |
      | workspace |
