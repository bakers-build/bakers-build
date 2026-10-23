@feature:team-islands
Feature: The team screen's five tabs are routes inside one island
  The five IA D12.3 tabs are real URLs and are swapped as one fragment. The
  tabs are ALTERNATIVES, not five coexisting hulls, so exactly one body is
  ever present. Every navigation scenario clicks TWICE: the second click is
  the assertion, because a declaration that is lost in the swap survives the
  first one (BB-408's measured defect, spec F10).

  Background:
    Given I am logged in as "Administrator"

  # NEGATIVE CONTROLS, and they are load-bearing rather than decorative. Every
  # AC-3 claim in this file rests on two detectors: a mark on the window (did the
  # document survive?) and a property on the rail node (did that node survive?).
  # A detector that cannot report failure proves nothing, and this suite went
  # green on its very first run against a repaired world — precisely the
  # situation in which a detector stuck at "yes" is invisible. These two
  # scenarios drive each detector to its failing side on purpose.
  @negative-control
  Scenario: The reload detector really does see a full page load
    Given I visit the team "Platform Crew"
    When I reload the page
    Then the document was reloaded

  # A rail click replaces the rail out of band, so this is the surface's real
  # behaviour and not a contrivance built to fail.
  @negative-control
  Scenario: The swap detector really does see a replaced rail
    Given I visit the team "Platform Crew"
    When I click the rail entry "Design Crew"
    Then the document was not reloaded
    And the rail was part of the swap

  @shell
  Scenario: The application shell renders on a front-end route
    When I visit the team "Platform Crew"
    Then the application shell is present
    And the page shows "Platform Crew"

  # Overview is the canonical address, and since BB-484 its body is the team's
  # own `full` view mode rendered by core's `_entity_view` — no controller, and
  # therefore no `[data-bakers-tab-body]` hull. The last step asserts that ABSENCE
  # on purpose: it is the browser-side half of the rollback, and the step that
  # would fail if a hand-rolled render path ever came back.
  Scenario: The canonical address shows Overview, and Overview shows the Projects relation
    When I visit the team "Platform Crew"
    Then the tab "Overview" is current
    And the tab body shows the Projects relation
    And the Overview body carries no controller hull

  Scenario: Two tab changes in a row do not reload the page
    Given I visit the team "Platform Crew"
    When I click the tab "Members"
    Then the address ends with "/members"
    And the document was not reloaded
    And the tab "Members" is current
    And the tab row rests on the header rule
    When I click the tab "Runs"
    Then the address ends with "/runs"
    And the document was not reloaded
    And the tab "Runs" is current
    And the tab row rests on the header rule

  # AC 12 — the return hop. Every other scenario in this file clicks AWAY from
  # Overview; none clicks BACK to it as the second click, so a declaration lost
  # on Overview's own swapped fragment specifically would go unseen. Starting
  # on Members rather than Overview means the first click (to Runs) is the one
  # that primes the detector, and the second click — back to Overview — is the
  # one that would fail if Overview's fragment came back undeclared.
  Scenario: Clicking back to Overview as the second click keeps the island alive
    Given I visit the team "Platform Crew" tab "Members"
    When I click the tab "Runs"
    Then the address ends with "/runs"
    And the document was not reloaded
    And the tab "Runs" is current
    When I click the tab "Overview"
    Then the document was not reloaded
    And the tab "Overview" is current
    And the tab body shows the Projects relation

  # The row is plain links with a thin underline on the current one. On a narrow
  # viewport it wraps onto further lines instead of scrolling or hiding tabs
  # behind a menu, so every destination stays visible and one tap away.
  # The viewport is narrow BEFORE the page loads, as on a phone: the rail opens
  # only from 768px up and remembers its state, so shrinking an already loaded
  # desktop page keeps a 232px rail and leaves the row about 50px.
  Scenario Outline: The tab row wraps on a narrow viewport and keeps every tab visible
    Given I view the page <width> pixels wide
    And I visit the team "Platform Crew"
    Then every tab fits within the viewport
    And exactly one tab is marked as the current page
    When I click the tab "Members"
    Then the document was not reloaded
    And exactly one tab is marked as the current page
    When I click the tab "Runs"
    Then the document was not reloaded
    And the tab "Runs" is current
    And every tab fits within the viewport
    And the tab row rests on the header rule

    Examples:
      | width |
      | 390   |
      | 320   |

  # Native links, not an ARIA tablist: Tab walks them, Enter follows one, and the
  # current one is announced as the current page. Keyboard activation goes through
  # the same island swap as a click, so it too is asserted on the second press.
  Scenario: Every tab is reachable and followed with the keyboard
    Given I visit the team "Platform Crew"
    Then every tab can be reached with the Tab key and shows a focus ring
    When I activate the tab "Members" with the keyboard
    Then the document was not reloaded
    And the tab "Members" is current
    And exactly one tab is marked as the current page
    When I activate the tab "Runs" with the keyboard
    Then the document was not reloaded
    And the tab "Runs" is current
    And exactly one tab is marked as the current page

  Scenario: A direct visit to a tab renders the whole page
    When I visit the team "Platform Crew" tab "Members"
    Then the tab "Members" is current
    And the shell rail is present
    And the page shows "Platform Crew"

  # AC 1, enumerated over ALL FIVE IA D12.3 tabs instead of a sample (BB-454:
  # Load/Delivery retired in favour of Overview/Stats). Overview is the
  # canonical address and carries no suffix of its own, so it is covered by
  # "The canonical address shows Overview" above; Stats, Runs, Members and
  # Tickets are the four suffixes under it. Each address is entered DIRECTLY,
  # so what is proved is that the URL alone renders its tab — not merely that
  # some click can arrive there.
  Scenario Outline: Every IA tab is reachable by its own URL
    When I visit the team "Platform Crew" tab "<tab>"
    Then the tab "<tab>" is current
    And the address ends with "<suffix>"
    And the application shell is present
    And the shell rail is present
    And exactly one tab body is present in the document

    Examples:
      | tab     | suffix   |
      | Stats   | /stats   |
      | Runs    | /runs    |
      | Members | /members |
      | Tickets | /tickets |

  # AC 3's OTHER half. "No full page load" is asserted by the document mark all
  # over this file; the request COUNT — "in one HTTP request" — was asserted
  # nowhere, so the AC was only half covered. Measured on 2026-09-01: one tab
  # click issues exactly one navigation request, an xhr to the tab's own URL, and
  # zero document requests.
  #
  # What is deliberately NOT claimed: that the server answered with a fragment.
  # It does not. `island-content` runs in configuration mode — the server returns
  # the ordinary whole page (measured: 64 KB carrying <html>, <head> and both
  # islands) and the client narrows it with hx-select. That is the human's
  # declared AC-3 deviation, so the checkable claims are the request count and
  # the surviving document, and nothing about the response body.
  Scenario: A tab change costs exactly one navigation request
    Given I visit the team "Platform Crew"
    When I click the tab "Members" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request
    And the document was not reloaded
    When I click the tab "Runs" and count the requests
    Then the tab change made exactly one navigation request
    And the tab change made no full document request
    And the document was not reloaded

  Scenario: The rail stands through a tab change and is not re-rendered
    Given I visit the team "Platform Crew"
    When I click the tab "Members"
    Then the shell rail is still present
    And the rail was not part of the swap
    When I click the tab "Runs"
    Then the shell rail is still present
    And the rail was not part of the swap

  # The question this answers, asked in review: does the rail's own current
  # entry refresh when the route changes? It has two halves and they have
  # DIFFERENT answers, so both are asserted rather than one standing in for the
  # other.
  Scenario: A rail click refreshes the rail itself
    Given I visit the team "Platform Crew"
    Then the rail marks "Platform Crew" as current
    And the rail does not mark "My work" as current
    When I click the rail entry "Design Crew"
    Then the document was not reloaded
    And the rail marks "Design Crew" as current
    When I click the rail entry "Platform Crew"
    Then the document was not reloaded
    And the rail marks "Platform Crew" as current

  Scenario: A tab click leaves the rail's current entry alone
    Given I visit the team "Platform Crew"
    When I click the tab "Members"
    Then the document was not reloaded
    And the rail marks "Platform Crew" as current
    When I click the tab "Runs"
    Then the document was not reloaded
    And the rail marks "Platform Crew" as current

  # THE INTERLEAVED CASE, and the strongest thing this surface can be asked.
  # A rail click replaces the rail node out of band; a tab click replaces the
  # content node. Each swap hands back markup that must carry its OWN
  # declaration, or the next click on that container is a full page load. Two
  # containers, alternating, so a declaration lost in either swap is caught by
  # the click after it — which is the defect that broke this mechanism's first
  # delivery, measured then as `rail attrs AFTER the click: []`.
  Scenario: Rail and tabs keep working when clicks alternate between them
    Given I visit the team "Platform Crew"
    When I click the rail entry "Design Crew"
    Then the document was not reloaded
    And the rail marks "Design Crew" as current
    When I click the tab "Members"
    Then the document was not reloaded
    And the address ends with "/members"
    And the tab "Members" is current
    And the rail marks "Design Crew" as current
    When I click the rail entry "Platform Crew"
    Then the document was not reloaded
    And the rail marks "Platform Crew" as current
    When I click the tab "Runs"
    Then the document was not reloaded
    And the tab "Runs" is current
    And the rail marks "Platform Crew" as current

  # THE FORM PRIMITIVE. Adding a member CHANGES content, which is the whole
  # reason the Members face is an island rather than a controller body: a
  # successful submit is answered with this island's fragment, so the list comes
  # back with the new row and nothing else on the page moves. Asserted by the
  # rail and the tab bar still being the nodes they were — presence would not
  # tell a survived node from a re-rendered one.
  #
  # THE ADD TARGET IS `both-bakeries`, a seeded current-workspace member who is
  # not already on Platform Crew. The picker is limited to parent-workspace
  # members, so uid 1 is refused and the roster stays at 3.
  Scenario: Adding a member re-renders only the members island
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew" tab "Members"
    Then the members list has 3 rows
    When I add the member "both-bakeries"
    Then the members list has 4 rows
    And the document was not reloaded
    And the rail was not part of the swap
    And the tab "Members" is current
    # THE SECOND CLICK, and here it lands on the fragment the ADD handed back
    # rather than on one a navigation produced. That is one swap deeper than any
    # other scenario reaches: if the submit's response fragment came back without
    # its own declaration, this click is a full page load. Exactly BB-408's
    # defect, on the one code path a tab click never exercises.
    When I click the tab "Runs"
    Then the document was not reloaded
    And the tab "Runs" is current
    And the rail was not part of the swap

  # NO DUPLICATE ROW, and that much is proved. What is NOT asserted here is that
  # the visitor is TOLD — measured on 2026-08-30, the second add produces no
  # aria-invalid, no error class and no status message, so the refusal is
  # silent. That is a real defect and it is recorded as one rather than dressed
  # up: this scenario locks in the property that matters for the data (the list
  # cannot grow a duplicate) and deliberately claims nothing about feedback,
  # because a scenario that asserted feedback would be asserting something that
  # does not happen.
  #
  # WHAT MAKES THE SECOND ADD MEAN ANYTHING is the step's own wait: it awaits the
  # submit's POST RESPONSE, so by the time the row count is read the server has
  # decided. Under the fixed sleep this step used to carry, `4 rows` was
  # satisfied instantly whether or not the second submit had been processed at
  # all — the assertion was true of a request that had not happened yet.
  Scenario: Adding the same member twice grows no second row
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew" tab "Members"
    When I add the member "both-bakeries"
    Then the members list has 4 rows
    When I add the member "both-bakeries"
    Then the members list has 4 rows
    And the document was not reloaded

  # BB-489 — THE ENTRY PATH IS THE SUBJECT, and that is the whole difference
  # between these two scenarios and every members scenario around them. Those
  # enter the face with `I visit the team … tab "Members"`, a URL, which is an
  # ordinary whole-page render; these two CLICK THE TAB, which is the boosted GET
  # path. Only the second of those two renders was missing the root pass, so the
  # form arrived carrying `form_token_placeholder_<hash>` and
  # `action="form_action_p_<hash>"`, the first submit posted the placeholder back,
  # Drupal rejected the token and answered 200 with a rebuilt form, and the roster
  # did not move. That rebuild came back through the mutation path, which DOES
  # resolve placeholders — so the second click wrote, and the surface merely felt
  # unreliable rather than broken. No scenario entered by clicking, so the suite
  # stayed green throughout.
  #
  # WHAT MAKES THESE ASSERTIONS BITE is that the add, pick and remove steps click
  # exactly ONCE and wait on that click's own POST response. A count read after a
  # refused token is the count before it.
  Scenario: A member added after a TAB CLICK lands on the first click
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew"
    When I click the tab "Members"
    Then the document was not reloaded
    And the members list has 3 rows
    When I add the member "both-bakeries"
    Then the members list has 4 rows
    And the document was not reloaded
    And the rail was not part of the swap
    When I remove the member "both-bakeries"
    Then the members list has 3 rows

  # THE SURFACE DOES NOT DIE AFTER ONE USE. Four actions in a row, each asserted
  # on its own first click, on a face entered by clicking the tab. A repair that
  # fixed only the fragment the tab click delivered — leaving every fragment after
  # it to hand back another placeholder — would pass the scenario above and fail
  # here on the second action.
  #
  # Re-runnable by construction: it adds the member it needs, restores the rank it
  # changed, and removes what it added, so the world is as it found it.
  Scenario: Four actions after a tab click each take effect on their own first click
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew"
    When I click the tab "Members"
    Then the members list has 3 rows
    When I add the member "both-bakeries"
    Then the members list has 4 rows
    When I pick the role "lead" for the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Lead"
    When I pick the role "member" for the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Member"
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"
    And the members list has 3 rows
    And the document was not reloaded
    And the rail was not part of the swap

  # BB-419 — REMOVING, asserted here as well as on the project screen, because
  # the control is ONE component and a shared control proved on one call site is
  # not proved. Adding then removing leaves the world as it found it, so unlike
  # the two add-only scenarios above this one is re-runnable.
  #
  # AND IT IS ASSERTED BY IDENTITY, not by a row count. Platform Crew holds more
  # than one member, so "back to the noted length" was satisfied just as well by
  # deleting the wrong one — which is exactly what the control did when this
  # scenario first reported green.
  Scenario: Removing a member re-renders only the members island
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew" tab "Members"
    And I note the members list
    When I add the member "both-bakeries"
    Then the members list has one more row
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"
    And the members list is back to the members I noted
    And the document was not reloaded
    And the rail was not part of the swap
    # THE SECOND CLICK, landing on the fragment the REMOVE handed back rather
    # than on one a navigation produced — one swap deeper than any tab-only
    # scenario reaches.
    When I click the tab "Runs"
    Then the document was not reloaded
    And the tab "Runs" is current

  # The other half of the per-group-type naming pair. The project feature
  # asserts the same wording; a control that said something different on
  # each screen fails one of the two. UPDATED BY BB-456: this used to be
  # the pair's other half, asserting "no access is revoked" because a team
  # granted no permission of its own (BB-321 D2). BB-456's `bb_team-
  # bb_team-lead` rank ends that — `removeSentence()` branches on whether
  # `assignableRoles()` is empty, never on the group's entity type, and it
  # is not empty for any team any more — so both screens now say the same
  # thing for the same reason, and this scenario asserts what
  # `project-members.feature`'s equivalent already does.
  Scenario: The remove control names the team it removes from
    When I visit the team "Platform Crew" tab "Members"
    Then the remove control names "Revokes their access."
    And no remove control names "no access is revoked"

  # BB-435 — CRITERION 5 on this call site. The team roster was a
  # `bb_theme:table` with three column headers; the settings section says a
  # member list is a LIST, and the rule now reaches both screens rather than one.
  Scenario: The team member list is a list and not a table
    When I visit the team "Platform Crew" tab "Members"
    Then the members list has no columns and no header row
    And consecutive member rows are separated comfortably

  # BB-435 — CRITERION 9 on this call site, REWRITTEN BY BB-456. This used to
  # assert an absence: a team granted no permissions, so an item carried its
  # membership STATE and no role control at all. BB-456's `bb_team-
  # bb_team-lead` rank is `bb_team`'s first `role_type: standard` role, and
  # `assignableRoles()` — read from config, never branched on the group's entity
  # type — now returns non-empty for every team, exactly as it already does for a
  # project. A team item therefore carries a role control instead of a state
  # badge, and the write behind it is proved the same way
  # `project-members.feature`'s "Picking a role writes it" scenario proves it: by
  # a reload, because a fragment that renders the picked value proves nothing
  # about storage on its own.
  #
  # The member is added by the scenario rather than read out of the seed, so the
  # assertion names an account it chose. The pick is restored before the member is
  # removed, which keeps this scenario re-runnable like the pair above it.
  Scenario: A team member item carries a role control, and picking a role writes it
    Given the team "Platform Crew" has no member "both-bakeries"
    And I visit the team "Platform Crew" tab "Members"
    When I add the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Member"
    And the member "both-bakeries" shows their initial and joined date on the left, role and remove control right-aligned
    When I pick the role "lead" for the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Lead"
    And the document was not reloaded
    And the rail was not part of the swap
    When I visit the team "Platform Crew" tab "Members"
    Then the member "both-bakeries" shows the role "Lead"
    When I pick the role "member" for the member "both-bakeries"
    Then the member "both-bakeries" shows the role "Member"
    When I remove the member "both-bakeries"
    Then the members list has no member "both-bakeries"
