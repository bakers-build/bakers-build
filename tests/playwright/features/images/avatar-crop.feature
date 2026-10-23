# One square crop per image, chosen in a dialog where the image is uploaded and
# used by every avatar built from the file. Every scenario operates the visible
# control with the pointer or the keyboard and then reads the avatar's pixels
# after a reload; none writes the hidden crop value. The fixture is red on the
# left, grey in the middle (the centred default) and blue with a yellow disc
# on the right.
@feature:avatar-crop
Feature: Avatar crop

  Background:
    Given I am logged in as the account "north-lead"
    And the account "north-lead" has no profile picture

  Scenario: Avatar crop — a dragged framing survives saving, and a second crop of the same file replaces it
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    Then the crop dialog is open
    When I drag the image in the crop dialog 400 pixels to the right
    Then the image in the crop dialog has moved
    When I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "red"
    And the rail shows my avatar as "red"
    When I visit my profile settings
    And I edit the crop of the profile picture
    And I drag the image in the crop dialog 800 pixels to the left
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "yellow"
    And the rail shows my avatar as "yellow"

  # A deployment rebuilds the caches; the theme's Alpine bundle must then load
  # under a new address, or a browser that cached the old bytes for a year
  # keeps running them against new markup ("imageCrop is not defined").
  # Aggregation does not bundle module scripts, so both settings must hold.
  Scenario Outline: Avatar crop — the crop editor works after a deployment with JavaScript aggregation <aggregation>
    Given JavaScript aggregation is <aggregation>
    When I visit my profile settings
    And I note the address of the Alpine bundle
    And the caches are rebuilt as a deployment does
    And I visit my profile settings
    Then the address of the Alpine bundle has changed
    When I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    Then the image in the crop dialog has moved
    And the page reported no error

    Examples:
      | aggregation |
      | enabled     |
      | disabled    |

  Scenario: Avatar crop — zoom and arrow keys frame the image without a pointer
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I zoom the crop in fully with the keyboard
    And I press the arrow key "ArrowRight" 150 times in the crop dialog
    And I apply the crop with the keyboard
    Then focus is back on the crop button
    When I save the profile form
    And I visit my user area
    Then my avatar shows "red"

  Scenario: Avatar crop — cancelling a new image keeps the image with its centred square
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    And I press Escape in the crop dialog
    Then the crop dialog is closed
    When I save the profile form
    And I visit my user area
    Then my avatar shows "grey"

  Scenario: Avatar crop — cancelling an edit restores the crop applied before it
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    And I apply the crop
    And I edit the crop of the profile picture
    And I drag the image in the crop dialog 800 pixels to the left
    And I press Escape in the crop dialog
    And I save the profile form
    And I visit my user area
    Then my avatar shows "red"

  Scenario: Avatar crop — a rejected form persists no crop
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    And I apply the crop
    And I save the profile form
    And I visit my profile settings
    And I edit the crop of the profile picture
    And I drag the image in the crop dialog 400 pixels to the left
    And I apply the crop
    And I change my nickname to "not/a/valid/name"
    And I save the profile form
    Then the nickname is marked invalid
    When I visit my user area
    Then my avatar shows "red"

  Scenario: Avatar crop — the dialog fits a narrow screen
    When I view the page 320 pixels wide
    And I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    Then the crop dialog fits within the viewport
    When I drag the image in the crop dialog 200 pixels to the right
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "red"

  # The picture is optional, so an account without one still saves.
  Scenario: Avatar crop — the profile saves without a picture
    When I visit my profile settings
    And I save the profile form
    Then the profile form shows no error

  Scenario: Avatar crop — Reset returns to the largest centred square
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    And I reset the crop
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "grey"

  # Red on top, grey in the middle, blue at the bottom.
  Scenario: Avatar crop — a portrait image is framed by dragging it vertically
    When I visit my profile settings
    And I choose the profile picture "avatar-tall.png"
    And I drag the image in the crop dialog 400 pixels to the down
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "red"

  # 60×20 pixels: the 20-pixel centred square is upscaled to the avatar.
  Scenario: Avatar crop — a small image is accepted and upscaled
    When I visit my profile settings
    And I choose the profile picture "avatar-small.png"
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "grey"

  # A replacement starts from its own centred square, never the old file's
  # crop, and a removed picture falls back to the initials.
  Scenario: Avatar crop — a replaced image starts with its own crop, a removed one leaves the initials
    When I visit my profile settings
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 400 pixels to the right
    And I apply the crop
    And I save the profile form
    And I visit my profile settings
    And I remove the profile picture
    And I choose the profile picture "avatar-tall.png"
    And I apply the crop
    And I save the profile form
    And I visit my user area
    Then my avatar shows "grey"
    When I visit my profile settings
    And I remove the profile picture
    And I save the profile form
    And I visit my user area
    Then my avatar shows my initials
