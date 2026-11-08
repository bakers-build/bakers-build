@feature:login
Feature: bakers.build sign-in
  A returning account types the same one e-mail address a new customer does, and
  the landing rule that decides where they end up is unchanged. Authentication
  and workspace access remain core decisions.

  BB-430 retired the password form: `/user/login` renders the e-mail login form
  form, so no scenario here submits a credential. The scenarios that need only
  an authenticated SESSION sign in by uid — the mechanism every other suite in
  this repository already uses — because the mailed-link path is expensive and
  is covered once, in features/sign-in/signup.feature. The scenarios that
  are about the LOGIN SURFACE itself go through the form.

  Scenario: The login form is inside the workspace-independent gate
    When I open anonymous login
    Then the login form is accessible
    And no password field is present
    And the gate chrome is present
    And the application shell is not present
    And the gate band shows the product mark and the slogan "Knead it. Ship it."
    And the gate offers no navigation
    And the page heading is "Log in"
    And the page has exactly one h1
    And the login form separates "Send login link" from "Continue with Google" with "or"

  Scenario Outline: The site root still takes an account straight to its work
    Given I am signed in as "<account>"
    And I open the site root
    Then the address is "<path>"

    Examples:
      | account      | path                |
      | north-lead   | /bakers/tickets       |
      | south-contributor | /other/tickets      |
      | both-bakeries  | /                  |
      | site-admin  | /                  |
      # Site root inbound-rewrites to the home route; empty overview, no 302.
      | no-bakery  | /                  |

  Scenario: The overview stays reachable for an account with one workspace
    Given I am signed in as "north-lead"
    And I open the landing route
    Then the workspace chooser is present
    And the address is "/home"
    And the create action is present

  Scenario: Ordinary multiple memberships retain the chooser
    Given I am signed in as "both-bakeries"
    And I open the landing route
    Then the workspace chooser is present
    And the workspace chooser offers "/bakers/tickets"
    And the workspace chooser offers "/other/tickets"
    And the gate band shows the product mark and the slogan "Knead it. Ship it."
    And the gate offers no navigation
    And the page has exactly one h1
    When I choose the workspace "/other/tickets"
    Then the application shell is present

  Scenario: The administrator keeps the read-scope bypass answer
    Given I am signed in as "site-admin"
    And I open the landing route
    Then the workspace chooser is present
    And the workspace chooser offers "/bakers/tickets"
    And the workspace chooser offers "/other/tickets"

  @functional
  Scenario: A completed account with no workspace reaches the overview
    Given I am signed in as "no-bakery"
    And I open the landing route
    Then the address is "/home"
    And the page has exactly one h1

  Scenario: The login form replaces the gate and both shell clicks keep the document
    Given I am signed in as "north-lead"
    And I open the site root
    Then the address is "/bakers/tickets"
    And the application shell is present
    When I mark the authenticated login document
    And I click the rail entry "Projects"
    Then the document was not reloaded
    When I click the rail entry "My work"
    Then the document was not reloaded

  Scenario Outline: Internal destinations retain access enforcement
    When I open anonymous login with destination "<destination>"
    And I request an login link for "south-contributor@example.test"
    And I follow the login link for "south-contributor@example.test"
    Then the login destination is "<destination>" with status <status>

    Examples:
      | destination    | status |
      | /other/tickets | 200    |
      | /bakers/tickets  | 404    |

  Scenario Outline: External destinations cannot leave the origin
    When I open anonymous login with destination "<destination>"
    And I request an login link for "north-lead@example.test"
    And I follow the login link for "north-lead@example.test"
    Then I am logged in
    And the address is "/home"
    And login navigation stayed on the test origin

    Examples:
      | destination                   |
      | https://example.com/forbidden |
      | //example.com/forbidden       |

  @functional
  Scenario: A true protected route returns through login while workspace URLs stay private
    When I open the anonymous protected login return route
    And I request an login link for "site-admin@example.test"
    And I follow the login link for "site-admin@example.test"
    Then the address is "/admin/config"
    And I am logged in

  Scenario: Signed-out workspace entry preserves the existing 404
    When I check anonymous workspace privacy

  Scenario: A login that sends no mail provisions nothing
    When I open anonymous login
    And I submit the login address "not-a-mail"
    Then the login error says "not-a-mail is not a valid e-mail address."
    And the login has not provisioned entities

  Scenario: Empty submission has an error associated with its field
    When I open anonymous login
    And I submit the login address ""
    Then the login error says "Please enter your e-mail address."
    And the login error is associated with its field

  Scenario Outline: The login form remains usable by keyboard at mobile and desktop sizes
    When I open anonymous login at width <width> and zoom <zoom>
    Then the login form is accessible
    And login controls fit the viewport and show keyboard focus

    Examples:
      | width | zoom |
      | 360   | 100  |
      | 390   | 100  |
      | 1440  | 100  |
      | 1440  | 200  |

  @nojs
  Scenario: A returning account signs in without JavaScript
    When I open anonymous login
    Then the login form is accessible
    When I request an login link for "south-contributor@example.test"
    And I follow the login link for "south-contributor@example.test"
    Then I am logged in
    And the address is "/home"
    When I open the site root
    Then the address is "/other/tickets"

  Scenario: Repeated requests preserve throttling on the login form
    When I exercise isolated login throttling
