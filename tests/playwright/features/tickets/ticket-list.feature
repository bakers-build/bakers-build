@feature:ticket-list
Feature: The ticket list is the nav home
  `/{workspace}/tickets` is IA D1/D5/D9's first screen, and its update mechanism
  is client-side: a facet pick is a boosted GET, htmx swaps `#island-content`
  and pushes the request URL into history. No PHP test can observe whether a
  pick kept the document, which is why this file exists at all.

  EVERY NAVIGATING SCENARIO PICKS MORE THAN ONCE. BB-408's first delivery
  applied the boost declaration at the caller, so every swapped fragment came
  back bare and a boosted navigation worked exactly once per page load. A
  one-pick scenario cannot see that, so the assertion is repeated after each
  pick rather than once at the end.

  A FACET OFFERS ONLY WHAT STILL YIELDS A HIT, so the value a scenario picks
  has to be one the NARROWED facet really offers. `min_count: 1` stops
  search_api_db appending every distinct indexed value at count 0, which is what
  used to let a scenario pick a value that matched nothing. Any scenario here
  that picks in a second facet therefore states the measurement it rests on.

  A FACET VALUE IS PICKED TWO WAYS, AND BOTH PATHS ARE COVERED. The keyboard
  path — focus the row's real `<input>` and press Space — drives BEF
  auto-submit, the boost, the pushed URL and the re-rendered chips without
  depending on where anything paints. The pointer path additionally depends on
  the paint order, and that is what R8 was: `.canvas__filters` is
  `position: sticky`, and a sticky element creates a stacking context whatever
  its `z-index`, so the picker panel's `z-index: 30` could not escape it and the
  table's positioned `<td class="relative">`, later in the document, painted over
  the rows. `document.elementFromPoint()` at the centre of the `Working` row
  returned that `<td>` and a raw click there picked nothing. Fixed on 2026-09-02
  by giving the sticky aside a `z-index` above the table's positioned cells, in
  `canvas` and through `designbook:debo`. Both paths are kept because they fail
  for different reasons: the keyboard scenario would still pass with the paint
  order broken again, and only the pointer scenario reads `elementFromPoint`.

  RE-MEASURED ON 2026-09-03 AGAINST WHAT SHIPS, because the 2026-09-02 measurement
  was taken against a bespoke Views style plugin that no longer exists. The table
  is now bound through core's own `table` style and one global
  `views-view-table.html.twig`, so its positioned cells are different cells and
  the fix was unverified. On the delivered surface at 1440x900, signed in as a
  non-admin member with ten rows on screen: `.canvas__filters` computes
  `position: sticky` with `z-index: 40`, a pointer at the centre of the `Working`
  row hits `SPAN.option-list__label` inside `DIV.option-picker__panel`, and the
  click picks `working`. THE DEFECT CONDITION SURVIVED THE REBUILD, which is what
  makes the fix load-bearing rather than a leftover: forcing `z-index: auto` back
  onto the aside in the same session makes the same point return `TD.relative` —
  the accent-rail cell core's `table` style emits on every row's first column —
  and nothing is picked at all. So this scenario still has a live subject.

  Background:
    # THE WORLD MUST BE INDEXED, and this states it rather than assuming it.
    # T11 measured `indexed before: 0 of 15` on a fresh
    # `ddev init --provider recipe-test`: the recipe seeds content and nothing
    # indexed it. `index_directly: true` (T11b) now indexes a ticket as it is
    # saved, so on a fresh world this step finds nothing to do — but the suite
    # must not depend on the order in which a provisioner happens to create the
    # index and the content, and a scenario that passes only because somebody
    # indexed by hand is a scenario that fails in CI.
    Given the ticket index is up to date

  # THE DETECTOR'S FAILING SIDE. Every "kept its document" claim below rests on
  # a symbol stamped on `window`, and a detector that cannot report failure
  # proves nothing — least of all on a suite that goes green on its first run.
  # A reload really does discard the document, so this drives the detector to
  # its failing side on a real property of the browser.
  @negative-control
  Scenario: The document detector really does see a full page load
    Given I am signed in as a member of the "bakers" workspace
    When I visit the ticket list of the "bakers" workspace
    And I reload the ticket list
    Then the document did not survive

  # THE UNFILTERED STATEMENT IS BACK, AND SO IS THE ASSERTION. For one day this
  # read `no active filters are stated`, because `views_filters_summary`'s
  # `buildFilterSummary()` returns `[]` when no filter has a value, so
  # `@exposed_filter_summary` interpolates to the empty string and the theme
  # hook the theme overrides is never invoked — `empty_label` was unreachable
  # from inside it. `active-filters` now carries a `chips` SLOT, and the
  # display's `display_builder` tree wraps `view_header` in an outer node that
  # fills it: a slot that renders no text is the signal the module cannot send,
  # so the outer node states `All tickets`. No hook of ours was added.
  #
  # AND THIS SCENARIO NOW VISITS THE FULL TABLE. `/{workspace}/tickets` became
  # the SCOPED `my_work` display on 2026-09-04 — the human's decision that a
  # filtered variant of the list is a Views display with real filters, not the
  # same display with facet defaults — and the find-a-ticket listing moved to
  # `/{workspace}/tickets/all`. Every scenario below whose subject is the facet
  # transport moved with it, because on the scoped list the values a scenario
  # can pick depend on which tickets the seed happened to assign to whichever
  # member it produced. `My work is the nav home` is the scenario that owns the
  # scoped screen.
  Scenario: Choosing two facets in turn keeps the document and writes the URL
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    Then the ticket listing is rendered inside the bakers.build shell
    And the ticket listing lists at least 1 ticket
    And the active filters read "All tickets"
    And the facets sit in the filters aside, not above the ticket listing
    And the "Workflow" facet offers "bakers.build work"
    And the "Priority" facet offers "High, Medium, Low"
    And the page carries exactly one main heading and one workspace description

    # PICK ONE. The address is asserted on the machine value while the row was
    # picked by its LABEL, which is T11b's split stated in the browser: the
    # operator reads `Working`, the URL carries `working`, and a rename cannot
    # break a shared link.
    When I choose "Working" in the "State" facet
    Then the document survived
    And the address carries "state[]=working"
    And the active filters read "State is Working"
    And exactly one active-filters strip sits above the ticket listing

    # PICK TWO, and this is the one that matters: it lands on the fragment the
    # first pick swapped in. A declaration lost in that swap still survives
    # pick one.
    When I choose "Review" in the "State" facet
    Then the document survived
    And the address carries "state[]=review"
    And the active filters read "State is either of Working, Review"

    # PICK THREE, in a DIFFERENT facet — two facets in turn, which is what the
    # criterion asks. `Medium` submits `2`, so this row's label and value differ
    # in kind and not merely in case.
    #
    # IT USED TO BE `High`, AND THE CHANGE IS DELIBERATE. Since a facet offers
    # only the values that still yield a hit, `High` is no longer on offer once
    # the list is narrowed to Working and Review — no ticket in either state has
    # priority 1 in the seeded world, so offering it would be offering an empty
    # result. Measured on a fresh `--provider recipe-test` world:
    # `?state[]=working&state[]=review` leaves the Priority facet reading
    # `Medium(2) Low(3)`. The scenario is re-pointed at a value that is really
    # there rather than relaxed, because "the facet still offers the value I
    # want to pick" is exactly what it should keep asserting.
    When I choose "Medium" in the "Priority" facet
    Then the document survived
    And the address carries "priority[]=2"
    And the active filters read "Priority is Medium"
    And the active filters read "State is either of Working, Review"

  # R8, and the honest regression gate for it. The scenario above picks by focus
  # and Space, which is a genuine user path but says nothing about the paint
  # order — it would pass with the panel buried under the table again. This one
  # reads `document.elementFromPoint()` at the centre of the row BEFORE clicking
  # it, so the failure names the element that is in the way rather than merely
  # reporting that nothing was picked, and then clicks with a raw pointer at
  # those coordinates.
  #
  # IT PICKS TWICE, for the same reason every navigating scenario here does, and
  # for one more: the second pick lands on the fragment the first one swapped in,
  # so it also proves the aside keeps its stacking order across a swap.
  Scenario: A facet value is picked with a pointer
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I click "Working" in the "State" facet with a pointer
    Then the document survived
    And the address carries "state[]=working"
    And the active filters read "State is Working"

    When I click "Review" in the "State" facet with a pointer
    Then the document survived
    And the address carries "state[]=review"
    And the active filters read "State is either of Working, Review"

  # THE ANY ROW IS A LINK, not a submitted empty value, and the address it
  # builds used to rewrite every scalar the same form submits (sort, search,
  # closed) as `key[]=value`. Better Exposed Filters then explodes the array-
  # shaped sort and the boosted clear request returns 500, so htmx never
  # swaps and the filtered list stays on screen. The second pick is the
  # usual proof that the swapped fragment still carries the boost.
  Scenario: Clearing a facet through its Any row restores the list
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I click "Working" in the "State" facet with a pointer
    Then the address carries "state[]=working"
    When I click "Any state" in the "State" facet with a pointer
    Then the address does not carry "state"
    And the ticket listing lists as many tickets as before
    When I click "Review" in the "State" facet with a pointer
    Then the address carries "state[]=review"

  # A checkbox row is a real `<input>` inside a `<label>`, so one click on it
  # used to reach `pick()` twice — once from the click that bubbled through
  # the label, once from the click the label forwards to its own control —
  # and `pick()` toggled the row's checkmark both times, cancelling itself
  # out while the input toggled exactly once underneath it. The row read as
  # untouched, and unchecking an already-checked row left the opposite lie:
  # the input unchecked while the checkmark stayed drawn. This scenario
  # reads all three facts of one row together — `<input>` `checked`,
  # `aria-selected`, and the marker's glyph — immediately after the click,
  # before the list swap, because that disagreement, not any single fact
  # alone and not the server-rendered fragment after the swap, is the defect.
  Scenario: A checkbox facet toggles visibly and narrows the list
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I click "Working" in the "State" facet with a pointer
    Then the "Working" row of the "State" facet reads as checked
    And the ticket listing lists fewer tickets than before
    And the address carries "state[]=working"

    When I click "Review" in the "State" facet with a pointer
    Then the "Working" row of the "State" facet reads as checked
    And the "Review" row of the "State" facet reads as checked

    When I click "Working" in the "State" facet with a pointer
    Then the "Working" row of the "State" facet reads as unchecked
    And the address does not carry "state[]=working"

  # A searchable facet puts a `type=search` input at the top of the panel,
  # inside the same exposed GET form BEF auto-submits. Typing, then clicking
  # a row, blurs the search field; BEF treats that `change` like a checkbox
  # and submits immediately, before the row's control is checked, so the
  # address never gains the facet parameter. The search only filters rows
  # the server already sent — it must not submit the form.
  Scenario: A searchable facet pick reaches the address
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I type "Design" in the "Team" facet search
    And I click "Design Crew" in the "Team" facet with a pointer
    Then the address carries "team[]="
    And the active filters read "Team is Design Crew"

  # A single-select facet is a radio. `pick()` used to assign
  # `input.checked` before the label's default action, which swallows the
  # native `change` Better Exposed Filters listens for, so the address
  # never gained the parameter. Checkbox facets (Labels, State) fire that
  # change themselves; radios do not, once the script has already checked
  # them. Dispatch `change` once after the exclusive write.
  Scenario: A single-select facet pick reaches the address
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I click "Bread" in the "Group" facet with a pointer
    Then the address carries "group="
    And the active filters read "Group is Bread"

  # THE HUMAN'S INSTRUCTION OF 2026-09-02: the summary must be clickable away
  # again. `active-filters` used to argue the opposite in its own documentation
  # — "a chip here is a statement", "a little × that removed nothing would be a
  # worse lie than no × at all" — and it deferred the wiring to the ticket that
  # gave this screen a real query. This is that ticket, and the component's
  # prose is corrected rather than left standing.
  #
  # ONLY A BROWSER CAN SEE THIS. The dismiss affordance is an anchor, so the
  # content island boosts it: following it must SWAP the fragment and push the
  # shorter URL rather than reload the page, and the addresses asserted below
  # after each removal are what prove each href keeps the other facets.
  #
  # THE AFFORDANCE IS STILL A LINK, WHICH IS NOT WHAT THE MODULE SHIPS, and the
  # difference is worth stating because it was nearly lost on 2026-09-04.
  # `views_filters_summary` builds its own dismiss link as
  # `Url::fromUserInput('/')` and removes CLIENT-SIDE: its JavaScript unchecks
  # the matching exposed control and calls `location.reload()`, which is a full
  # page load, per VALUE rather than per facet, and sweeps `form_build_id` and
  # `form_id` into the address through `new FormData(form)`. Taking that
  # mechanism would have turned every assertion in this scenario over: `the
  # document survived` would have had to become its opposite. So the addresses
  # are built in `bb_theme/templates/views-filters-summary.html.twig` from the
  # set the module states, the `×` stays an anchor, and this scenario keeps
  # every claim it had.
  #
  # WHAT DID CHANGE IS THE GLYPH, AND IT IS NOW THE COMPONENT'S OWN. The
  # module's area returns its summary as a plain-string `#markup`, so
  # `Renderer::ensureMarkupIsSafe()` runs the whole strip through
  # `Xss::filterAdmin()`, whose tag list has no `svg` and no `use`: the sprite
  # icon `active-filters` used to draw inside the anchor was DELETED and the
  # anchor arrived empty, with no box and nothing to click. A `::after` rule in
  # `css/app.src.css` put a `×` back; the component emits a text `×` now, so
  # that rule is deleted and the anchor measures 9.27x14 in a browser. The same
  # filter strips what it reads as a URL scheme out of attribute values, which
  # is why the accessible name no longer carries a colon: it reads
  # `Remove the State filter`, which the removal step clicks by that name.
  #
  # IT REMOVES TWICE, for the reason every navigating scenario here does: the
  # second removal lands on the fragment the first one swapped in, which is
  # where a lost boost declaration shows up.
  #
  # THE FIRST REMOVAL LEAVES THE OTHER FILTER STANDING, asserted explicitly.
  # A chip that removed everything would satisfy "the address does not carry
  # state[]=working" perfectly well.
  Scenario: A chip is removed with a pointer, keeping the document
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I choose "Working" in the "State" facet
    And I choose "Medium" in the "Priority" facet
    Then the active filters read "State is Working"
    And the active filters read "Priority is Medium"

    When I remove the "State" chip
    Then the document survived
    And the address does not carry "state[]=working"
    And the address carries "priority[]=2"
    And the active filters read "Priority is Medium"

    When I remove the "Priority" chip
    Then the document survived
    And the address does not carry "priority[]=2"
    # Removing the LAST chip lands back on the unfiltered statement rather than
    # on nothing. It read `no active filters are stated` for one day, while
    # `empty_label` was unreachable through `views_filters_summary`; the outer
    # `active-filters` node in the display's own `display_builder` tree states
    # it again, from a slot that rendered no text.
    And the active filters read "All tickets"

  # AC 5. Nothing remembers the filter set: the pushed URL IS the request that
  # produced what is on screen, so reload and share need no mechanism of their
  # own. The share half is a FRESH TAB — a new browser context would lose the
  # session, and a reload of the same tab would not prove the address alone
  # carries the state.
  Scenario: The filter set survives a reload and a share
    Given I am signed in as a member of the "bakers" workspace
    When I visit the full ticket list of the "bakers" workspace
    And I choose "Working" in the "State" facet
    And I reload the ticket list
    Then the active filters read "State is Working"
    And the "State" facet shows "Working" as chosen
    When I open the current address in a fresh tab
    Then the active filters read "State is Working"
    And the "State" facet shows "Working" as chosen

  # AC 7, and exactly AC 7. The `filters` aside composes `collapsible`, which is
  # a native `<details>` over a real `<summary>`: no behaviour, no CSS class, no
  # `Drupal.attachBehaviors`. The two facet steps this scenario used to carry
  # are gone and must not come back: `option_picker`'s panel is a
  # JS-toggled `<div hidden>` rather than a native disclosure, so a facet cannot
  # be OPENED with JavaScript off (spec D8, corrected 2026-09-02). What does
  # hold without JavaScript is the value path, and that is a Kernel test's
  # business — `BbOptionPickerWidgetTest::testThePickedValueReachesTheFormWithoutJavascript`
  # drives the real form builder with a JS-less browser's query.
  Scenario: The filter panel collapses without JavaScript
    Given I am signed in as a member of the "bakers" workspace
    And JavaScript is disabled
    When I visit the ticket list of the "bakers" workspace
    Then the filter panel is open
    When I click the "Filters" heading
    Then the filter panel is collapsed

  # AC 8, asserted from the side the defect fails on: what the other
  # workspace's member CANNOT see. A scenario asserting that the right member
  # sees the right rows would pass with the tenancy processor deleted.
  #
  # The screen is asserted to have RENDERED before absence is read off it, so a
  # blank page cannot satisfy this: an empty result set renders no table at all,
  # and "no rows" would then be true of a page that failed.
  #
  # WHAT THIS SCENARIO IS NOT, measured on 2026-09-02 rather than assumed. It is
  # not a detector for spec D2's `bb_read_scope` processor. The processor was
  # removed from the live index and this scenario STILL PASSED, because the view
  # is protected twice: the processor narrows the QUERY, and search_api's own
  # Views query plugin additionally access-checks every returned item
  # (`skip_access` is off by default, SearchApiQuery.php:716). With the
  # processor gone the raw index query answered 15 of 15 to this account while
  # the view answered 0, and the pager total was 0 too, so not even the count
  # leaks — there is nothing on this page for a browser assertion to catch.
  #
  # So the criterion is met by the composition and this scenario states the
  # criterion, while the thing that isolates the processor is
  # `TicketIndexReadScopeTest::testAnOutsiderSeesNothingOfAnotherWorkspace`,
  # which queries the INDEX directly. Whoever deletes the processor must know
  # that this file will not notice.
  Scenario: A member of another workspace sees none of these tickets
    Given I am signed in as a member of the "other" workspace
    When I visit the full ticket list of the "other" workspace
    Then the ticket list screen is rendered
    And no ticket of the "bakers" workspace is listed

  # THE SCOPED DISPLAY, WHICH IS WHAT `/{workspace}/tickets` IS SINCE
  # 2026-09-04. The human decided twice that day: a filtered variant of the
  # ticket list is a Views DISPLAY with real filters, not the same display
  # reached with facet defaults chosen for the reader; and every path stays
  # under the workspace prefix. So `my_work` holds the nav home and the full
  # find-a-ticket listing is one segment along.
  #
  # ONLY A BROWSER CAN SEE THE HALF THAT MATTERS HERE. A Kernel test asserts the
  # filters and the two paths — `TicketMyWorkDisplayTest` does — and can observe
  # nothing about the RAIL, whose current entry is decided by
  # `BbMenuSource` comparing generated URLs for exact equality
  # against the route the browser is on. The pair of claims is the assertion:
  # marked on `/{workspace}/tickets`, NOT marked on `/{workspace}/tickets/all`,
  # which share their first two segments and which a prefix comparison would
  # collapse.
  #
  # THE SET IS COMPARED, NOT THE COUNT. A row count passes on a screen showing
  # somebody else's three tickets, which is exactly what a broken assignee
  # filter produces. Both sides of the comparison are derived from Drupal: the
  # account from the seed, the terminal states from
  # `TypeWorkflows::terminalTicketStates()` — the same source the display's own
  # filter reads, so a scenario cannot go stale against a workflow change.
  Scenario: My work is the nav home, narrowed to the reader
    Given I am signed in as a member of the "bakers" workspace
    When I visit the ticket list of the "bakers" workspace
    Then the ticket list screen is rendered
    And the active filters read "My open tickets"
    And the ticket listing lists exactly my open tickets
    And the rail marks "My work" as current
    And the filters read "Closed, Group, Project, Template, State, Parent, Workflow, Created by, Priority, Labels" in order

    # The current-user predicate already fixes the assignee, so an assignee
    # key left in an old link must neither narrow nor widen the rows.
    When I note the listed tickets
    And I reopen the address with the removed keys "assignee[]=1"
    Then the ticket listing lists exactly my open tickets
    And the listed tickets are unchanged
    And no active filter names "Assignee"

    # ONE SEGMENT ALONG IS THE WHOLE LIST, and the rail knows it is a different
    # screen. It is also this scenario's SECOND navigation, so a boost
    # declaration lost in a swap fails here as it does everywhere else in this
    # file.
    When I visit the full ticket list of the "bakers" workspace
    Then the ticket list screen is rendered
    And the ticket listing lists more than my open tickets
    And the active filters read "All tickets"
    And the rail does not mark "My work" as current

  # BB-492 AC1/AC2/AC5. `my_work` used to answer the same rows in every
  # workspace, because the display declared no argument for its own
  # `%bb_workspace` segment and the only narrowing that reached the query was
  # `BbReadScope`, resolved from the account across EVERY workspace it
  # belongs to. Only a browser round trip across a real workspace switch can
  # show this: a Kernel test renders one display invocation at a time and
  # cannot observe the SAME reader's list changing as the address does.
  #
  # A SECOND WORKSPACE IS BUILT FOR THIS SCENARIO, because the recipe world
  # seeds the signed-in member into exactly one — the whole defect is invisible
  # with one workspace, since the address and the account-wide scope agree by
  # accident.
  #
  # THE SWITCH IS THE ASSERTION. The negative half at "bakers" is what the
  # defect fails: before the fix this reader's ticket from BOTH workspaces
  # appeared under "bakers" too.
  @bb-492-second-workspace
  Scenario: My work follows the active workspace on a switch
    Given I am signed in as a member of the "bakers" workspace
    And I have an open ticket assigned to me in the second workspace "bb-492-beta"

    When I visit the ticket list of the "bakers" workspace
    Then the ticket list screen is rendered
    And the second workspace's ticket is not listed

    When I visit the ticket list of the "bb-492-beta" workspace
    Then the ticket list screen is rendered
    And the second workspace's ticket is listed

  # BB-490. `my_work` — the nav home this screen visits below — is the
  # display whose loss of a state-based hiding predicate (Task 3) makes the
  # `closed` field the ONE thing standing between the reader and a landing
  # page full of their own finished work, so this is exactly where the
  # control's default matters most.
  #
  # EVERY NAVIGATING SCENARIO PICKS TWICE, for the reason every one in this
  # file does: a boost declaration lost in a swap works exactly once per page
  # load, and the second pick lands on the fragment the first one swapped in.
  Scenario: The ticket list hides closed tickets and says so
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has an open ticket and a closed ticket assigned to me
    When I visit the ticket list of the "bakers" workspace
    Then the closed control marks "Open" as the current position
    And I do not see the closed ticket

  Scenario: The ticket list shows closed tickets when asked
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has an open ticket and a closed ticket assigned to me
    When I visit the ticket list of the "bakers" workspace
    And I choose the "All" closed position
    And I choose the "All" closed position
    Then the closed control marks "All" as the current position
    And I see the closed ticket

  Scenario: The ticket list can show closed tickets alone
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has an open ticket and a closed ticket assigned to me
    When I visit the ticket list of the "bakers" workspace
    And I choose the "Closed" closed position
    And I choose the "Closed" closed position
    Then the closed control marks "Closed" as the current position
    And I see the closed ticket
    And I do not see the open ticket

  # THE FINAL REVIEW'S CRITICAL #2, and the reason this scenario exists at all.
  # `project_tickets` renders the same segmented control `my_work` does — Task 5
  # placed the source in both displays' canvas — but only `my_work` was ever
  # wired to `bb_closed_rows` (Task 6); `project_tickets` and `team_tickets`
  # kept their own filter set, which does not inherit a `default` filter it
  # never names, so the control rendered and did nothing. This scenario visits
  # the PROJECT tab rather than the workspace nav home, on the same "bakers.build
  # Platform" project the fixture below files both tickets against.
  Scenario: The closed control also narrows a project's own tickets tab
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has an open ticket and a closed ticket assigned to me
    When I visit the tickets tab of project "bakers.build Platform"
    Then the closed control marks "Open" as the current position
    And I do not see the closed ticket

    When I choose the "All" closed position
    And I choose the "All" closed position
    Then the closed control marks "All" as the current position
    And I see the closed ticket
    And I see the open ticket

  # Carried over from the final review verdict: `team_tickets` is the sixth
  # and last of the six ticket/run listings, and the only one that had no
  # runtime coverage of its own — it shares its filter configuration with
  # `project_tickets` above (the same displays that fixed the review's
  # critical #2 together), so this scenario visits the TEAM tab instead of
  # the project tab, on "Design Crew", one of "bakers.build Platform"'s two teams,
  # against the same fixture tickets that project files.
  Scenario: The closed control also narrows a team's own tickets tab
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has an open ticket and a closed ticket assigned to me
    When I visit the tickets tab of team "Design Crew"
    Then the closed control marks "Open" as the current position
    And I do not see the closed ticket

    When I choose the "All" closed position
    And I choose the "All" closed position
    Then the closed control marks "All" as the current position
    And I see the closed ticket
    And I see the open ticket

  # THE SEARCH BOX READS ORIGIN REFERENCES. A ticket records the issue it came
  # from as a full URL; the box accepts `#19`, `<repo>#19` and the URL in any
  # spelling, and compares a normalised `<repo path>#<number>` exactly, so issue
  # 19 never matches issue 190. The "bakers.build Platform" fixture project's repository
  # is `https://gitlab.example.com/bakers/bakers`, which makes `bakers` its alias and
  # the only repository a member can read — so a bare `#19` is unambiguous.
  # Each scenario searches twice, because a search is a navigation and a boost
  # lost in a swap works exactly once per page load.
  Scenario: The search finds tickets by the origin issue they came from
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has tickets from origin issues 19, 190 and twice 20
    When I visit the ticket list
    And I search the ticket list for "#19"
    Then the ticket list shows the origin tickets "issue 19"
    And the ticket list does not show the origin ticket "issue 190"

    When I search the ticket list for "bakers#20"
    Then the ticket list shows the origin tickets "issue 20 first, issue 20 second"
    And the ticket list does not show the origin ticket "issue 19"

  Scenario: Every spelling of an origin URL finds the same ticket
    Given I am signed in as a member of the "bakers" workspace
    And the workspace has tickets from origin issues 19, 190 and twice 20
    When I visit the ticket list
    And I search the ticket list for "https://gitlab.example.com/bakers/bakers/-/issues/19"
    Then the ticket list shows the origin tickets "issue 19"

    When I search the ticket list for "http://gitlab.example.com/bakers/bakers/issues/19/"
    Then the ticket list shows the origin tickets "issue 19"
    And the ticket list does not show the origin ticket "issue 190"

  Scenario: An unknown repository alias says so instead of listing nothing
    Given I am signed in as a member of the "bakers" workspace
    When I visit the ticket list
    And I search the ticket list for "nosuchrepo#1"
    Then the page says 'No repository matches "nosuchrepo". Known in your projects: bakers.'

    When I search the ticket list for "nosuchrepo#2"
    Then the page says 'No repository matches "nosuchrepo". Known in your projects: bakers.'

  # BAKERS-56 D11/D12: the State facet counts the tickets each state would list
  # under the list's other filters, and its footer offers "Only open states",
  # on My work, Projects › Tickets and Teams alike. Four tickets assigned to the
  # reader in project BB, found by one title search, keep the counts exact on a
  # shared site. The Done one is hidden by the default Open position, so it is
  # not counted until the closed control shows it.
  Scenario: State options show counts
    Given I am signed in as a member of the "bakers" workspace
    And tickets titled "State tally" are assigned to me in the states "working, working, review, done"
    When I visit the ticket list of the "bakers" workspace
    And I search the ticket list for "State tally"
    Then the "State" facet counts "Working 2, Review 1"

    When I visit the tickets tab of project "bakers.build Platform"
    And I search the ticket list for "State tally"
    Then the "State" facet counts "Working 2, Review 1"

    When I visit the tickets tab of team "Design Crew"
    And I search the ticket list for "State tally"
    Then the "State" facet counts "Working 2, Review 1"
    When I choose the "All" closed position
    Then the "State" facet counts "Working 2, Review 1, Done 1"

  Scenario: Only open states keeps only open tickets
    Given I am signed in as a member of the "bakers" workspace
    And tickets titled "State tally" are assigned to me in the states "working, working, review, done"
    When I visit the ticket list of the "bakers" workspace
    And I search the ticket list for "State tally"
    And I choose the "All" closed position
    Then the ticket listing lists exactly the tickets "State tally 1, State tally 2, State tally 3, State tally 4"
    When I choose "Only open states" in the "State" facet footer
    Then the address carries "state[]=working"
    And the address does not carry "state[]=done"
    And the ticket listing lists exactly the tickets "State tally 1, State tally 2, State tally 3"

    When I visit the tickets tab of project "bakers.build Platform"
    And I search the ticket list for "State tally"
    And I choose the "All" closed position
    And I choose "Only open states" in the "State" facet footer
    Then the ticket listing lists exactly the tickets "State tally 1, State tally 2, State tally 3"

    When I visit the tickets tab of team "Design Crew"
    And I search the ticket list for "State tally"
    And I choose the "All" closed position
    And I choose "Only open states" in the "State" facet footer
    Then the ticket listing lists exactly the tickets "State tally 1, State tally 2, State tally 3"

  # BAKERS-56 D13/D14: the Parent facet narrows to one parent's direct
  # sub-tickets and reads `?parent=<KEY>`; "Has sub-tickets" lists the parents
  # themselves. The "Brood" family is open and assigned to the reader in
  # project BB: Brood parent > Brood child 1 > Brood grandchild, and
  # Brood parent > Brood child 2.
  Scenario: Filter by one parent
    Given I am signed in as a member of the "bakers" workspace
    And the ticket family "Brood" is assigned to me
    When I visit the ticket list of the "bakers" workspace
    And I type the key of "Brood parent" in the "Parent" facet search
    And I click "Brood parent" in the "Parent" facet with a pointer
    Then the address carries the key of "Brood parent" as "parent"
    And the active filters read the key and title of "Brood parent" as "Parent"
    And the ticket listing lists exactly the tickets "Brood child 1, Brood child 2"

    # A second pick replaces the first: the facet is single-select.
    When I type "Brood child" in the "Parent" facet search
    And I click "Brood child 1" in the "Parent" facet with a pointer
    Then the address carries the key of "Brood child 1" as "parent"
    And the address does not carry the key of "Brood parent"
    And the ticket listing lists exactly the tickets "Brood grandchild"

    When I remove the "Parent" chip
    Then the document survived
    And the address does not carry "parent="
    And the active filters read "My open tickets"

  Scenario: Open a parent-filtered list by its address
    Given I am signed in as a member of the "bakers" workspace
    And the ticket family "Brood" is assigned to me
    When I visit the tickets tab of project "bakers.build Platform"
    And I open this list for the parent "Brood parent"
    Then the active filters read the key and title of "Brood parent" as "Parent"
    And the "Parent" facet shows "Brood parent" as chosen
    And the ticket listing lists exactly the tickets "Brood child 1, Brood child 2"

    When I visit the tickets tab of team "Design Crew"
    And I open this list for the parent "Brood parent"
    Then the active filters read the key and title of "Brood parent" as "Parent"
    And the ticket listing lists exactly the tickets "Brood child 1, Brood child 2"
    When I remove the "Parent" chip
    Then the address does not carry "parent="

  # BAKERS-56 AC-7/D15: search and sort share one 36 px row, measured at
  # compact density on a 1440 px wide screen, and keep their accessible names.
  Scenario: Search and sort share one 36 px row
    Given I am signed in as a member of the "bakers" workspace
    And the viewport is 1440 pixels wide
    When I visit the ticket list of the "bakers" workspace
    Then search and sort share one row 36 px high
    When I visit the tickets tab of project "bakers.build Platform"
    Then search and sort share one row 36 px high
    When I visit the tickets tab of team "Design Crew"
    Then search and sort share one row 36 px high

  Scenario: On a narrow screen the bar wraps without horizontal scroll
    Given I am signed in as a member of the "bakers" workspace
    And the viewport is 390 pixels wide
    And the rail has no remembered state
    When I visit the ticket list of the "bakers" workspace
    Then search and sort sit inside the screen
    And the document does not scroll horizontally

  Scenario: Has sub-tickets
    Given I am signed in as a member of the "bakers" workspace
    And the ticket family "Brood" is assigned to me
    When I visit the ticket list of the "bakers" workspace
    And I search the ticket list for "Brood"
    And I switch on "Has sub-tickets"
    Then the address carries "has_children=1"
    And the ticket listing lists exactly the tickets "Brood parent, Brood child 1"
    # The checkbox states itself; a chip would read "Has sub-tickets is 1".
    And no active filter names "Has sub-tickets"

    # It combines with the parent filter: of Brood parent's two children,
    # only Brood child 1 has a sub-ticket of its own.
    When I open this list for the parent "Brood parent"
    Then the ticket listing lists exactly the tickets "Brood child 1"
