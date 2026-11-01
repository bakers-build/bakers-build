# HTMX four-step wizard (identity, About you, skill setup, then prepare your
# first project), then workspace overview. Completion is a stored Boolean;
# optional profile fullness does not skip the wizard.
@feature:onboarding
Feature: The onboarding wizard before the workspace overview

  Scenario: A new account finishes the wizard and reaches the overview
    Given no account exists for "onboarding-alpha@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-alpha@example.com"
    And I follow the login link for "onboarding-alpha@example.com"
    Then the identity step is present
    When I continue from the identity step
    Then the about-you step is present
    When I finish the onboarding wizard
    Then the address is "/home"
    And the home overview empty state is present

  Scenario: Next and back stay on the same document
    Given no account exists for "onboarding-beta@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-beta@example.com"
    And I follow the login link for "onboarding-beta@example.com"
    Then the identity step is present
    When I mark the authenticated login document
    And I continue from the identity step
    Then the about-you step is present
    And the document was not reloaded
    When I go back from the about-you step
    Then the identity step is present
    And the document was not reloaded

  Scenario: Completing the wizard does not send the user through the old invite chain
    Given no account exists for "onboarding-gamma@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-gamma@example.com"
    And I follow the login link for "onboarding-gamma@example.com"
    And I continue from the identity step
    And I finish the onboarding wizard
    Then the address is "/home"
    And the invite screen is not present

  # The wizard's own scenarios above assert where a click lands and never that
  # a typed value survives it. This one submits, finishes, and reads the
  # stored values back through Drush.
  Scenario: What the identity step saves is still there afterwards
    Given no account exists for "onboarding-delta@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-delta@example.com"
    And I follow the login link for "onboarding-delta@example.com"
    Then the identity step is present
    When I fill in the identity step with name "Ada Lovelace" and nickname "ada-lovelace"
    And I continue from the identity step
    And I finish the onboarding wizard
    Then the account "onboarding-delta@example.com" has the full name "Ada Lovelace"
    And the account "onboarding-delta@example.com" is named "ada-lovelace"

  # AC-3's skip half. Skip advances without writing, so a name typed
  # and then skipped must not reach the account.
  Scenario: Skipping the identity step writes nothing
    Given no account exists for "onboarding-epsilon@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-epsilon@example.com"
    And I follow the login link for "onboarding-epsilon@example.com"
    Then the identity step is present
    When I fill in the identity step with name "Discarded Name" and nickname "discarded"
    And I skip the identity step
    Then the about-you step is present
    When I finish the onboarding wizard
    Then the account "onboarding-epsilon@example.com" has no full name
    And the account "onboarding-epsilon@example.com" is not named "discarded"

  # The upload itself: the file travels with the step's Next POST and
  # becomes the account's picture.
  Scenario: An attached picture becomes the account's picture
    Given no account exists for "onboarding-zeta@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-zeta@example.com"
    And I follow the login link for "onboarding-zeta@example.com"
    Then the identity step is present
    When I attach the picture "avatar-wide.png"
    And I continue from the identity step
    And I finish the onboarding wizard
    Then the account "onboarding-zeta@example.com" has a saved picture

  Scenario: Every wizard action stays on the same document
    Given no account exists for "onboarding-eta@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-eta@example.com"
    And I follow the login link for "onboarding-eta@example.com"
    Then the identity step is present
    When I mark the authenticated login document
    And I record the wizard's requests
    And I fill in the identity step with name "Eta" and nickname "north-lead"
    And I press Next on the identity step
    Then the identity step shows the error "This nickname is already taken."
    And the document was not reloaded
    When I attach the picture "not-an-image.png"
    And I fill in the identity step with name "Eta" and nickname "onboarding-eta"
    And I press Next on the identity step
    Then the identity step shows the error "The image file is invalid or the image type is not allowed."
    And the document was not reloaded
    When I attach the picture "avatar-wide.png"
    Then the picture control has no upload button
    When I continue from the identity step
    Then the document was not reloaded
    When I go back from the about-you step
    And I skip the identity step
    Then the document was not reloaded
    When I finish the onboarding wizard
    Then the document was not reloaded
    And every wizard request was sent by HTMX
    And the account "onboarding-eta@example.com" has a saved picture

  # The wizard renders the account form's own picture widget, so a picture is
  # cropped here exactly as on the account form, and the crop survives the
  # HTMX swaps of Next and Back: the dialog is operated again on the swapped-in
  # step, and the saved avatar shows the final framing.
  Scenario: Avatar crop — the wizard crops with the account form's widget across Next and Back
    Given no account exists for "onboarding-theta@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-theta@example.com"
    And I follow the login link for "onboarding-theta@example.com"
    Then the identity step is present
    When I mark the authenticated login document
    And I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 800 pixels to the left
    And I apply the crop
    And I continue from the identity step
    And I go back from the about-you step
    And I edit the crop of the profile picture
    And I drag the image in the crop dialog 800 pixels to the right
    And I apply the crop
    And I continue from the identity step
    And I go back from the about-you step
    And I edit the crop of the profile picture
    And I press Escape in the crop dialog
    And I continue from the identity step
    And I finish the onboarding wizard
    Then the document was not reloaded
    And the account "onboarding-theta@example.com" has an avatar showing "red"

  Scenario: Avatar crop — skipping the identity step saves neither the picture nor its crop
    Given no account exists for "onboarding-iota@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-iota@example.com"
    And I follow the login link for "onboarding-iota@example.com"
    Then the identity step is present
    When I choose the profile picture "avatar-wide.png"
    And I drag the image in the crop dialog 800 pixels to the left
    And I apply the crop
    And I skip the identity step
    And I finish the onboarding wizard
    Then the account "onboarding-iota@example.com" has no saved picture

  Scenario: About-you Next opens the same setup guide for an uninvited account
    Given no account exists for "onboarding-setup@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-setup@example.com"
    And I follow the login link for "onboarding-setup@example.com"
    Then the identity step is present
    When I continue from the identity step
    Then the about-you step is present
    When I mark the authenticated login document
    And I continue from the about-you step
    Then the setup installation step is present
    And the document was not reloaded
    And the command "/plugin marketplace add https://bakers.build/marketplace.json" is shown
    And the command "/plugin install bakers@bakers" is shown
    And the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is shown
    When I choose the "Codex" agent filter
    Then the command "codex plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git" is shown
    And the command "codex plugin add bakers@bakers" is shown
    And the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is shown
    And the setup page links to the documentation and Claude skills
    And the account "onboarding-setup@example.com" has not completed onboarding
    When I continue from the setup step
    Then the project step is present
    And the command "Use `bakers:bb-init-project` to connect this checkout as a bakers.build project." is shown
    And the project page links to init-project
    And both finish actions are offered
    And the account "onboarding-setup@example.com" has not completed onboarding

  Scenario: Finish and create submits a real workspace form
    Given no account exists for "onboarding-create@example.com"
    And no workspace is slugged "setup-create-gmbh"
    When I open anonymous login
    And I request an login link for "onboarding-create@example.com"
    And I follow the login link for "onboarding-create@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I continue from the about-you step
    And I continue from the setup step
    Then both finish actions are offered
    When I choose finish and create a new workspace
    Then the address is "/home/new-workspace"
    When I create the workspace "Setup Create GmbH"
    Then the address is "/home"
    And the workspace "setup-create-gmbh" is owned by "onboarding-create@example.com" as lead
    When I choose the workspace "/setup-create-gmbh/tickets"
    Then the address is "/setup-create-gmbh/tickets"

  Scenario: Copy reports failure when the clipboard is denied and never submits the form
    Given no account exists for "onboarding-copy@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-copy@example.com"
    And I follow the login link for "onboarding-copy@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I mark the authenticated login document
    And I continue from the about-you step
    Then the setup installation step is present
    And the document was not reloaded
    When I set the viewport to 390 by 844
    And clipboard writes fail
    And I copy the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build."
    Then the copy status for "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is "Copy failed. Select the command and copy it yourself."
    And the address is "/home/onboarding"
    And the setup installation step is present
    When I set the viewport to 1280 by 800
    And clipboard writes succeed
    And I copy the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." with the keyboard
    Then the copy status for "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is "Copied"
    And the clipboard holds "Use `bakers:bb-init` to guide me through installing and setting up bakers.build."
    And the address is "/home/onboarding"

  Scenario: Copy reports failure when the clipboard API is unavailable
    Given no account exists for "onboarding-copy-missing@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-copy-missing@example.com"
    And I follow the login link for "onboarding-copy-missing@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I continue from the about-you step
    Then the setup installation step is present
    When the clipboard API is unavailable
    And I copy the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build."
    Then the copy status for "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is "Copy failed. Select the command and copy it yourself."
    And the address is "/home/onboarding"
    And the setup installation step is present

  Scenario: Progress resumes, Set up later dismisses, and Setup guide reopens twice
    Given no account exists for "onboarding-resume@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-resume@example.com"
    And I follow the login link for "onboarding-resume@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I continue from the about-you step
    Then the setup installation step is present
    When I reload the page
    Then the setup installation step is present
    When I open anonymous login
    And I request an login link for "onboarding-resume@example.com"
    And I follow the login link for "onboarding-resume@example.com"
    Then the setup installation step is present
    And the account "onboarding-resume@example.com" has not completed onboarding
    When I set up later
    Then the address is "/home"
    And the home overview empty state is present
    And the account "onboarding-resume@example.com" has completed onboarding
    When I open anonymous login
    And I request an login link for "onboarding-resume@example.com"
    And I follow the login link for "onboarding-resume@example.com"
    Then the address is "/home"
    When I open the setup guide
    Then the setup installation step is present
    When I set up later
    Then the address is "/home"
    When I open the setup guide
    Then the setup installation step is present
    And the account "onboarding-resume@example.com" has completed onboarding

  Scenario: A late invitation replaces Finish and create with Home
    Given no account exists for "onboarding-late@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-late@example.com"
    And I follow the login link for "onboarding-late@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I continue from the about-you step
    And I continue from the setup step
    Then both finish actions are offered
    And a lead has invited "onboarding-late@example.com" to "bakers"
    When I choose finish and create a new workspace
    Then the address is "/home"
    And the overview offers joining "bakers"
    And the account holds no membership on "bakers"

  @nojs
  Scenario: Setup commands and navigation work without JavaScript
    Given no account exists for "onboarding-nojs@example.com"
    When I open anonymous login
    And I request an login link for "onboarding-nojs@example.com"
    And I follow the login link for "onboarding-nojs@example.com"
    Then the identity step is present
    When I continue from the identity step
    Then the about-you step is present
    When I continue from the about-you step
    Then the setup installation step is present
    And the command "Use `bakers:bb-init` to guide me through installing and setting up bakers.build." is shown
    When I continue from the setup step
    Then the project step is present
    And the command "Use `bakers:bb-init-project` to connect this checkout as a bakers.build project." is shown
    When I finish the setup guide
    Then the address is "/home"
    And the home overview empty state is present
    And the account "onboarding-nojs@example.com" has completed onboarding
