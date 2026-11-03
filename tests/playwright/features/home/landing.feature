@feature:home-landing
Feature: The site root lands the operator on their own My work
  `/` is `system.site.front` and points at `/home`, a route that carries no
  workspace. `BbHomeController` resolves the reader's own read scope and
  gives one of exactly three answers: a 302 into their workspace's My work
  list, the chooser when there is more than one candidate, or a named absence
  when there is none. This file measures all three IN A BROWSER, because the
  acceptance criteria are about the ADDRESS the operator ends up at — and an
  address bar is not something a PHP test can read.

  Every navigating scenario clicks TWICE. A declaration lost in a fragment swap
  survives the first click, so a one-click scenario cannot see the class of
  defect that broke this mechanism's first delivery.

  # AC 1 and AC 2. `north-lead` holds exactly one membership — the default
  # workspace — so the site root must redirect rather than ask.
  #
  # THE SECOND ASSERTION IS THE CRITERION, not a restatement of the first: the
  # resulting address has to NAME the workspace and not be `/`. A controller
  # that rendered My work at `/home` would satisfy "reaches My work" and fail
  # "is bookmarkable at an address that names the workspace", and only the
  # address tells the two apart.
  @landing
  Scenario: An operator with one workspace is taken to that workspace's My work
    Given I am logged in as the account "north-lead"
    When I open the site root
    Then the address is "/bakers/tickets"
    And the address is not "/"
    And the address is not "/home"
    And the application shell is present

  # AC 4, and the reason the seed grew an account for it (BB-415 R3). Before
  # `south-contributor` existed, every seeded account's only workspace was the
  # default one — so a controller that returned `BbWorkspace::DEFAULT_SLUG`
  # unconditionally would have passed the scenario above and this file would
  # have proved nothing about tenancy.
  @landing @tenancy
  Scenario: A member of only the other workspace is taken to THAT workspace
    Given I am logged in as the account "south-contributor"
    When I open the site root
    Then the address is "/other/tickets"
    And the address is not "/bakers/tickets"

  # AC 5's positive half, on the account that actually has several candidates.
  # `Administrator` holds no og_membership at all — `bb_core_install()`
  # creates the default workspace with no membership — and reaches both
  # workspaces through the read scope's BYPASS branch. So this scenario is also
  # the one that proves the bypass exists: without it this account would get
  # the empty state on a site that has two workspaces.
  #
  # ASSERTED AGAINST THE RENDERED OUTPUT, never against a build (spec R4). The
  # workspace list is an array prop; ui_patterns' CompatibilityChecker mistypes
  # those and display_builder drops an invalid SDC prop silently, so a green
  # Storybook build says nothing about what reaches this page.
  # THE ADDRESS STAYS `/`, AND THAT IS MEASURED RATHER THAN WISHED. This
  # scenario first asserted `/home` and failed with `Received: "/"`. The reason
  # is the mechanism, not a defect: `PathProcessorFront` is an INBOUND rewrite,
  # so `/` reaches the `/home` route without the browser ever being told to go
  # anywhere. Only the single-workspace branch issues a real 302, which is why
  # only that branch can satisfy acceptance criterion 2 — and it is the branch
  # the criterion is about, because a chooser has no workspace to name yet.
  @landing @chooser
  Scenario: An operator with several workspaces is asked which one
    Given I am logged in as "Administrator"
    When I open the site root
    Then the address is "/"
    And the workspace chooser is present
    And the workspace chooser offers "/bakers/tickets"
    And the workspace chooser offers "/other/tickets"
    And the gate chrome is present
    And the application shell is not present

  # The chooser is a real way in, not a dead end: the row the operator picks has
  # to take them to that workspace's work.
  @landing @chooser
  Scenario: Choosing a workspace from the chooser reaches its My work
    Given I am logged in as "Administrator"
    When I open the site root
    And I choose the workspace "/other/tickets"
    Then the address is "/other/tickets"
    And the application shell is present

  # THE TWO-CLICK SCENARIO. Arriving at My work through a 302 from `/` is a
  # different entry into the shell from typing the address, and the risk it
  # carries is the island one: the boosted rail has to keep working after a
  # redirect. The first click can succeed on a declaration that the swap then
  # loses, so the second click is the assertion and the first is only its
  # precondition.
  @landing @island
  Scenario: The rail still boosts after arriving through the landing redirect
    Given I am logged in as the account "north-lead"
    When I open the site root
    Then the address is "/bakers/tickets"
    When I click the rail entry "Projects"
    Then the document was not reloaded
    When I click the rail entry "My work"
    Then the document was not reloaded
    And the address is "/bakers/tickets"

  # The create action is its own row under the chooser, not glued to the last
  # card: the overview body is a zone whose `md` gap is the `card` spacing role
  # (4 spacing steps: 16 pixels, 24 at cozy density).
  @landing @chooser
  Scenario: The create action stands apart from the chooser
    Given I am logged in as "Administrator"
    When I open the site root
    Then the workspace chooser is present
    And the create action stands 16 pixels below the content above it
    When the layout density is cozy
    Then the create action stands 24 pixels below the content above it

  @landing @chooser
  Scenario: The create action stands apart from the chooser on a narrow viewport
    Given the viewport is 360 pixels wide
    And I am logged in as "Administrator"
    When I open the site root
    Then the create action stands 16 pixels below the content above it
    And the page does not overflow horizontally

  @landing
  Scenario: The create action stands apart from the empty state
    Given I am logged in as the account "no-bakery"
    When I open the site root
    Then the create action stands 16 pixels below the content above it
