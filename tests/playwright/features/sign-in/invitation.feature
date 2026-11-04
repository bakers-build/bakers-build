# A workspace invitation carries a person all the way in.
#
# Both scenarios start from a mail Mailpit actually delivered — the
# invitation itself — never from a hand-built URL. Only the SIGN-IN half
# differs between them: the e-mail door (code) and the stub provider, the same
# split `features/sign-in/oauth.feature` already draws for provider sign-in.
#
# EVERY NAVIGATING SCENARIO CLICKS TWICE (suite convention, `team-islands.
# feature`/`my-work-tabs.feature`): the first click proves a mechanism fired
# once, the second proves the destination it landed on is a real, working
# shell rather than a page that merely rendered once. Both scenarios end by
# switching the My work tab and asserting the tab change kept the document,
# the same detector `my-work-tabs.feature` uses.
Feature: A workspace invitation

  Scenario: Following the mail link and signing in with the e-mail code joins the workspace
    Given a pending invitation exists for a new address on workspace "bakers"
    When I follow the invitation link from the mail
    And I sign in with the e-mail code for the invited address
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    Then the overview offers joining "bakers"
    And the create action stands 20 pixels below the content above it
    When I join the invited workspace "bakers"
    And I choose the workspace "/bakers/tickets"
    Then the address is "/bakers/tickets"
    When I click the tab "Stats" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request

  Scenario: Following the mail link and signing in through the stub provider joins the workspace
    Given a pending invitation exists for a new address on workspace "bakers"
    When I follow the invitation link from the mail
    And I sign in through the stub provider as the invited address
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    Then the overview offers joining "bakers"
    When I join the invited workspace "bakers"
    And I choose the workspace "/bakers/tickets"
    Then the address is "/bakers/tickets"
    When I click the tab "Stats" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request

  # The invitation's grant, applied on joining: the chosen workspace role and
  # the one team chosen. Guest is the smallest role that may read projects
  # (Member carries no permission of its own), and below Admin the team decides
  # which projects are visible: the person sees the team's projects and not a
  # project that belongs only to the other team.
  Scenario: Joining a Guest invitation with a team shows that team's projects only
    Given a pending invitation exists for a new address on workspace "bakers" as "Guest" into the team "Design Crew"
    When I follow the invitation link from the mail
    And I sign in with the e-mail code for the invited address
    Then the identity step is present
    When I continue from the identity step
    And I finish the onboarding wizard
    Then the overview offers joining "bakers"
    When I join the invited workspace "bakers"
    Then the invited account holds the workspace role "Guest" in "bakers" and is an ordinary member of the team "Design Crew"
    When I open the projects of workspace "bakers"
    And I open the projects of workspace "bakers" again
    Then the projects list shows "bakers-e2e-project"
    And the projects list does not show "Alpha North"

  Scenario: Setup does not accept a pending invitation
    Given a pending invitation exists for a new address on workspace "bakers" as "Guest" into the team "Design Crew"
    When I follow the invitation link from the mail
    And I sign in with the e-mail code for the invited address
    And I continue from the identity step
    And I continue from the about-you step
    Then the setup guide step is present
    And only the home finish action is offered
    When I finish the setup guide
    Then the overview offers joining "bakers"
    And the invited account holds no membership on "bakers"
    When I join the invited workspace "bakers"
    Then the invited account holds the workspace role "Guest" in "bakers" and is an ordinary member of the team "Design Crew"
