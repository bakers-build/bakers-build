<?php

/**
 * @file
 * Hooks provided by the Island module, and the contracts around them.
 *
 * The hooks are below. What a host author has to know before reaching for one:
 *
 * @section island_links The two link builders
 *
 * Whether a link is an HTMX link is a property of the component that renders
 * it. There is no global link decoration, no route-keyed table and no per-link
 * kind: an island writes its own links through one of two protected builders on
 * IslandPluginBase, and an internal link no island renders is an ordinary link.
 *
 * @code
 * // Replace an island — its own by default, or a named peer.
 * $this->linkToRoute(
 *   $route, $params, $label, $target = NULL, $push_url = TRUE,
 *   $url_options = [],
 * );
 * // Replace the CONTENTS of a container the page owns.
 * $this->linkToPage(
 *   $route, $params, $label, $target, $push_url = TRUE, $url_options = [],
 * );
 * @endcode
 *
 * The choice between them is not computable from the target, which is why it is
 * two methods rather than a flag. One question settles it: does the thing being
 * replaced live in the response fragment, or only in the document?
 * `hx-target` resolves against the live document; `hx-select` resolves against
 * the response. A Drupal HTMX fragment is exactly the page's main content, so
 * an island — or any container a controller renders inside its result — is in
 * the fragment and takes linkToRoute(), while a container written by the page
 * template is never in the fragment and takes linkToPage(), which needs no
 * selection.
 *
 * @section island_container The theme's half of the contract
 *
 * The container a linkToPage() link targets belongs to whoever owns the page.
 * This module neither creates it nor knows its id, and nothing enforces the
 * pairing: a renamed container, or a component naming one the page does not
 * have, is a click that does NOTHING — HTMX resolves hx-target before issuing
 * the request and abandons it when it does not resolve, having already
 * cancelled the anchor's navigation. tests/themes/island_e2e is that half
 * written out and executed by the browser harness.
 *
 * Two consequences: the container is never itself replaced, because the swap is
 * innerHTML; and `status_messages` arrives inside it on a swap while rendering
 * in its own region on a full page load, because the fragment body is messages
 * plus main content and all of it lands in the target.
 *
 * @section island_boost Client-declared navigation
 *
 * A container may declare which islands a link inside it should re-render. The
 * client sends the declaration with the request and the server renders exactly
 * that set: a lookup, with no route inference, no comparison against the
 * previous page and no JavaScript.
 *
 * The island is the ONE author of its own declaration: it answers
 * IslandInterface::boost(), and every render asks it — the host's page build,
 * the main fragment of a boosted GET, the out-of-band peer of somebody else's,
 * and the mutation path. A host that applied a declaration itself would be a
 * second author, and the page and the fragment would then agree only for as
 * long as somebody kept two call sites in step.
 *
 * @code
 * // A rail whose links swap the content region and bring the rail along.
 * public function boost(): IslandBoost {
 *   return IslandBoost::to('#island-tasks-content');
 * }
 *
 * // A content region whose links swap itself, and nothing else.
 * public function boost(): IslandBoost {
 *   return IslandBoost::to();
 * }
 * @endcode
 *
 * The default is NULL — an island that says nothing gets an ordinary container
 * and its links stay ordinary links. The island never repeats its own id:
 * IslandWrapper::wrap() applies the declaration to the container it just
 * built, and IslandBoost reads the id from there.
 *
 * The island method is the ONLY author. A placed Drupal block used to be a
 * second one, through `island.*` third-party settings written by an "Island"
 * fieldset on the block configuration form; it was withdrawn because the
 * wrapper that mechanism added inside the block's lazy builder was the sole
 * reason a boosted GET fragment could not be root-rendered — and root-rendering
 * it is what makes a form in that fragment postable on the first click. An
 * island is placed through an `island.profile.*`.
 *
 * Asking an island what it declares is a LOOKUP, which is why criterion 4
 * still holds: the answer comes from what the island IS, never from the route,
 * the referrer or a comparison against the previous page.
 *
 * Nothing is ever written on a link. hx-boost is inherited and htmx takes the
 * anchor's own href as the path, so the anchor keeps working on a direct
 * visit, on a middle click and with JavaScript disabled. htmx also refuses an
 * external host and a bare '#' anchor before any decision of this module's
 * reaches them, which is why no exclusion list exists here.
 *
 * Never write hx-select-oob or the X-Island-Also header by hand, in PHP or in
 * Twig. htmx merges hx-headers per key but takes hx-select-oob closest-wins,
 * so two hand-written copies of one fact agree until either is nested and then
 * diverge silently. IslandBoost derives both from one array, a contract check
 * fails the build on a second author, and a pre-render guard fails a nested
 * declaration that drops an ancestor's selector.
 *
 * @section island_mutations Mutation responses
 *
 * A mutation answers with the islands it names and nothing else.
 * IslandResponse::rebuildSelf() and ::rebuild() name them explicitly;
 * ::dispatch() names them indirectly, by letting the host's other islands
 * subscribe to an event. IslandResponder renders exactly that set into one
 * CacheableResponse — the triggering island as the main fragment, the rest as
 * hx-swap-oob fragments — so a mutation never carries an island the caller did
 * not ask for.
 *
 * AN ISLAND FORM MUST LIVE INSIDE ITS ROUTE'S MAIN CONTENT. Core's htmx
 * renderer only ever assembles main content, so a form whose container is
 * somewhere else — a shell overlay, say — never reaches Form API through the
 * ordinary POST at all: not validated, not submitted, not refused. This module
 * carried a second view subscriber for exactly that case and no longer does.
 * The reason it could be deleted rather than fixed is that
 * the case has a better answer: give the surface a ROUTE of its own, and its
 * form IS main content. IslandFragmentResolver stays as the one place a
 * client-named html id becomes a fragment and the one place
 * IslandViewAccessInterface::accessIsland() is asked.
 *
 * Form\IslandFormBase::validateIslandForm() takes $form BY REFERENCE for the
 * same reason: FormBuilder::processForm() never rebuilds a form that ends
 * validation with an error, so a subclass that must show the refusal in that
 * same response has to mutate $form inside validateIslandForm() itself.
 *
 * @section island_host The host seam
 *
 * A host implements IslandContextProviderInterface and registers one service
 * tagged `island.context_provider`. The interface is four methods — hostId(),
 * getIslandIds(), getIslandConfiguration() and getIslandData(). An island is
 * rebuilt, never remembered: getIslandData() is asked again for the request
 * being served, and the only thing that persists between two responses is the
 * stable DOM id, which is an address rather than state.
 *
 * A host whose islands should answer a BOOSTED link implements one further
 * interface, IslandViewAccessInterface, whose single method accessIsland()
 * says who may see each island on its own. It is separate, and omitting it is
 * not an error: a host that does not implement it simply never answers a
 * boosted GET. That default is deliberate — the boosted path resolves an
 * island from an html id the client sent, over hosts rather than over the
 * current route, so nothing but the host knows whether the visitor was
 * entitled to it, and forbidden-by-omission is the only safe reading.
 */

declare(strict_types=1);

/**
 * @addtogroup hooks
 * @{
 */

/**
 * Alter island plugin definitions.
 *
 * @param array $definitions
 *   The island plugin definitions, keyed by plugin id.
 */
function hook_island_info_alter(array &$definitions): void {
  $definitions['task_list']['default_region'] = 'sidebar';
}

/**
 * Alter the registered island types.
 *
 * Island types are plain strings declared by the Island attribute. Host
 * modules register their own types; this hook lets other modules adjust them.
 *
 * @param array $types
 *   The island type labels, keyed by type id.
 */
function hook_island_types_alter(array &$types): void {
  $types['widget'] = t('Widget');
}

/**
 * @} End of "addtogroup hooks".
 */
