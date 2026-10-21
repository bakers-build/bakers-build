@feature:registration
Feature: bakers.build sign-up
  A new customer types one e-mail address, receives a one-time login link, and
  lands in the product. The workspace choice happens after landing: they create
  their own or join one that has invited their address.

  Not to be confused with features/conductors/registration.feature, which means
  conductor registration.

  Scenario: The login page is a one-field form inside the gate
    When I open anonymous login
    Then the login form is accessible
    And the login form is not built on the dialog grammar
    And the gate chrome is present
    And the gate card holds the form without a frame of its own
    And the application shell is not present

  Scenario: An unknown address is mailed a link and gets no account yet
    Given no account exists for "neu@example.com"
    When I open anonymous login
    And I request an login link for "neu@example.com"
    Then the login confirmation is present
    And exactly one login mail was sent to "neu@example.com"
    And the login created no account
    And the login provisioned no workspace

  Scenario: The account appears only when the link is redeemed
    Given no account exists for "deferred@example.com"
    When I open anonymous login
    And I request an login link for "deferred@example.com"
    Then the login created no account
    When I follow the login link for "deferred@example.com"
    Then I am logged in
    And the login created one account for "deferred@example.com"
    And the address is "/home/onboarding"

  Scenario: An unredeemed link leaves nothing behind
    Given no account exists for "ignored@example.com"
    When I open anonymous login
    And I request an login link for "ignored@example.com"
    And I open anonymous login
    Then the login created no account

  Scenario: The mail carries both halves
    Given no account exists for "pair@example.com"
    When I open anonymous login
    And I request an login link for "pair@example.com"
    Then the login confirmation is present
    And the mail carries a link and a six-digit code

  Scenario: The code signs in from the confirmation screen
    Given no account exists for "code@example.com"
    When I open anonymous login
    And I request an login link for "code@example.com"
    And I sign in with the code from the mail
    Then I am logged in
    And the address is "/home/onboarding"
    And the link from the same mail signs in without duplicating the account
    And the login created one account for "code@example.com"

  Scenario: A mistyped code is refused without spending it
    Given no account exists for "typo@example.com"
    When I open anonymous login
    And I request an login link for "typo@example.com"
    And I submit the wrong code
    Then the code was refused and still works
    And I am logged in

  Scenario: A known address gets the same answer and no second account
    When I open anonymous login
    And I request an login link for "login-quiet@example.com"
    Then the login confirmation is present
    And exactly one login mail was sent to "login-quiet@example.com"
    And the login created no account

  Scenario: The answer never discloses whether an address has an account
    Then the login answer is identical for "neu2@example.com" and "login-quiet@example.com"

  Scenario: Following the link establishes a session and lands in the product
    Given no account exists for "landing@example.com"
    When I open anonymous login
    And I request an login link for "landing@example.com"
    And I follow the login link for "landing@example.com"
    Then I am logged in
    And the document was reloaded
    And the address is "/home/onboarding"
    And the landing carries no password promise
    And the landing is not the account edit form

  Scenario: The link works only once
    Given no account exists for "once@example.com"
    When I open anonymous login
    And I request an login link for "once@example.com"
    And I follow the login link for "once@example.com"
    Then I am logged in
    When I follow the same login link again
    Then I am not logged in

  Scenario: A brand-new account finishes the wizard on the empty overview
    Given no account exists for "dead-end@example.com"
    When I open anonymous login
    And I request an login link for "dead-end@example.com"
    And I follow the login link for "dead-end@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    Then the address is "/home"
    And the home overview empty state is present
    And the create action is present beside the empty state

  Scenario: Creating a workspace provisions the tenancy and lands on the overview
    Given no account exists for "founder@example.com"
    And no workspace is slugged "aerzte-soehne-gmbh"
    When I open anonymous login
    And I request an login link for "founder@example.com"
    And I follow the login link for "founder@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    And I create the workspace "Ärzte & Söhne GmbH"
    Then the address is "/home"
    And the invite screen is not present
    And the workspace "aerzte-soehne-gmbh" is owned by "founder@example.com" as lead
    And the workspace "aerzte-soehne-gmbh" has one team with that account as lead
    And the sign-up provisioned exactly one workspace, one team and two memberships

  Scenario: Both shell clicks keep the document after landing in a new workspace
    Given no account exists for "clicks@example.com"
    And no workspace is slugged "click-test"
    When I open anonymous login
    And I request an login link for "clicks@example.com"
    And I follow the login link for "clicks@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    And I create the workspace "Click Test"
    And I choose the workspace "/click-test/tickets"
    Then the application shell is present
    When I mark the authenticated login document
    And I click the rail entry "Projects"
    Then the document was not reloaded
    When I click the rail entry "My work"
    Then the document was not reloaded

  Scenario: An invited address is offered its workspace and joins it deliberately
    Given no account exists for "invited@example.com"
    And a lead has invited "invited@example.com" to "other"
    When I open anonymous login
    And I request an login link for "invited@example.com"
    And I follow the login link for "invited@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    Then the overview offers joining "other"
    And the joinable row carries a workspace, a slug and a join link
    And the account holds no membership on "other"
    When I join the invited workspace "other"
    Then the address is "/home"
    And the invite screen is not present
    And the account is an active member of "other"
    And the invitation for "invited@example.com" is consumed
    And the join provisioned exactly one membership

  Scenario: A consumed invitation cannot be reused
    Given no account exists for "reuse@example.com"
    And a lead has invited "reuse@example.com" to "other"
    When I open anonymous login
    And I request an login link for "reuse@example.com"
    And I follow the login link for "reuse@example.com"
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    And I join the invited workspace "other"
    When I open the join confirm route for the consumed invitation
    Then the join confirm route states the invitation is no longer valid
    And the join provisioned no membership

  Scenario: The join confirm route refuses somebody else's invitation
    Given a lead has invited "not-me@example.com" to "other"
    Given I am signed in as "login-empty"
    And I open the join confirm route for the invitation to "not-me@example.com"
    Then the join confirm route answers 403
    And the join provisioned no membership

  Scenario Outline: An unusable address is refused on its own field
    When I open anonymous login
    And I submit the login address "<address>"
    Then the login error says "<error>"
    And the login error is associated with its field
    And the login created no account
    And no login mail was sent

    Examples:
      | address    | error                                         |
      | not-a-mail | not-a-mail is not a valid e-mail address.     |
      |            | Please enter your e-mail address.             |

  Scenario: Repeated requests for one address are throttled and mail nothing further
    When I exercise isolated login throttling

  Scenario Outline: The login stays usable by keyboard at mobile and desktop sizes
    When I open anonymous login at width <width> and zoom <zoom>
    Then the login form is accessible
    And login controls fit the viewport and show keyboard focus
    When I request an login link using only the keyboard for "kbd<width>-<zoom>@example.com"
    Then the login confirmation is present

    Examples:
      | width | zoom |
      | 360   | 100  |
      | 1440  | 100  |
      | 1440  | 200  |

  @nojs
  Scenario: The whole path works without JavaScript
    Given no account exists for "nojs@example.com"
    And no workspace is slugged "no-script-gmbh"
    When I open anonymous login
    And I request an login link for "nojs@example.com"
    And I follow the login link for "nojs@example.com"
    Then I am logged in
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    And I create the workspace "No Script GmbH"
    Then the address is "/home"

  Scenario: Signed-out workspace entry preserves the existing 404
    When I check anonymous workspace privacy
