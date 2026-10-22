# Island

HTMX integration for Drupal core. It ships **two** mechanisms, and the second is
usually the better one:

- An **island** is a self-contained page fragment — a plugin class — that can be
  re-rendered on its own over HTMX and re-render its peers in the same request.
  This is the module's name and most of its documentation.
- A **wrapped route** needs no plugin at all. `Render\WrappedRouteRenderer` is a
  registered `_wrapper_format` that renders an ordinary route's own main content
  into a named component and answers without the page's chrome. Where a surface
  can be a route — an add form, a confirmation, anything reached by a link —
  that is the shape to prefer: a route's form IS main content, so the Form API
  validates it, refuses it and re-renders it with none of this module involved.
  See that class's docblock for the service registration and for why it owns
  `renderResponse()` outright. The module ships its own default hull,
  `island:dialog` (`components/dialog/`), registered against the
  `island_dialog` wrapper format in `island.services.yml` — enabling `island`
  alone is enough to get a working wrapper format, with no theme involved. A
  consumer that wants its own richer hull registers its own format instead,
  the way `bb_core` does for `bb_dialog` / `bb_theme:dialog`; that
  registration does not compete with this one; it is a second, independent
  format. The slot contract — a `title` prop, an `open` prop, `message`
  rendered above `body` — is documented on the component itself and is
  deliberately **not enforced**: SDC silently drops props and slots a
  component does not declare, so a hull that gets the shape wrong renders a
  200 with an empty slot rather than an error, and the only real assurance is
  a test asserting the rendered content.

Everything runs on **Drupal core HTMX (11.3+)** (`core/htmx` +
`core/drupal.htmx` and `Drupal\Core\Htmx\Htmx`), core fragment negotiation
(`_wrapper_format`), Drupal routes with their normal access checks, and the Form
API. The mechanism itself is JS-free.

The module does ship exactly one script, and it is a **shim for a defect in
core's own htmx bridge** rather than a part of the design:
`js/island.behaviors.js` re-attaches `Drupal.behaviors` to island fragments
that arrived **out of band**, which core drops. Its own file docblock carries
the measurement, the core file and line, and the condition under which it is
deleted again.

Requirements: Drupal `^11.3`. Nothing to install, no parallel HTMX bundle.

## Apps and profiles

Manage applications at `/admin/structure/island/apps` and their profiles at
`/admin/structure/island/profiles`. An app identifies a module-provided data and
access provider; its profiles select an SDC layout and own stable placements.
Use **Use this app for page layouts** on an app to select it for ordinary page
composition. This writes `island.settings.page_app`; the standalone module
leaves that setting empty. bakers.build's recipe selects its `bakers` app and
the core `default` provider. Display Builder editor integration is independent.

An applicable page profile owns the complete page structure. Like Display
Builder Page Layout, its page variant selects pass-through page and region
templates for that request, preventing the theme from adding another layout
around the app. Drupal still renders the HTML document and its attachments;
pages without an applicable profile keep the normal theme templates.

Select **Update layout** after changing a profile's layout. Existing placements
retain their IDs and configuration. Placements whose slots disappeared remain
unassigned until explicitly moved or removed. Adding another placement retains
unsaved settings. The same plugin can occupy several placements.

Conditional profiles are selected by ascending priority and then profile ID.
The configured default must also be enabled and satisfy its conditions. If no
profile applies, Drupal renders the normal page. Front-page matching uses
Drupal's processed current path. Navigation inside a profile updates its
declared
placements; navigation to another profile or a normal page loads the destination
document when the old target no longer exists.

Render a profile with `island.profile_renderer->render($profile, $instance_id)`.
Every repeated rendering needs a distinct stable instance ID. Treat wrapper and
host IDs as opaque: use `IslandRuntimeId::forPlacement()` and `::forHost()`.
The host encodes the app, profile and instance tuple; it does not depend on a
slot, weight or render-time randomness. Fresh action/form POST requests can
reconstruct an enabled persisted profile host. Identification does not grant
access: the provider's current placement access and the plugin's action access
still apply, alongside route access and CSRF protections.

`IslandResponse::rebuild()` and configured event subscriptions name placement
IDs inside the current host. Explicit rebuilds win when an event also requests
the same placement, so each response contains one replacement per target.
Foreign, disabled and denied placements produce no protected output. Providers
must return current data and cacheable access decisions on every request.

The optional `island_ui_patterns` module maps component props and slots through
installed UI Patterns sources. A provider can return typed Drupal contexts in
`getIslandData()` under `contexts`; these are request data. Do not store them
in profile configuration. Source `context_mapping` identifies those contexts.
Providers may implement `AppContextProviderInterface::getProfileContexts()`
to expose typed preview or empty contexts in the mapping source chooser. Use
the same context identifiers as runtime data; these objects are never saved
with a placement.
Configured events rebuild the component with current host data. Profiles record
their owning app, component and plugin dependencies for configuration imports.
Standard Menu, Page Content and Block configurations have typed schemas; custom
island plugins can declare `island.configuration.PLUGIN_ID`.

## Quickest path to a new island

One plugin class in `my_module/src/Plugin/Island/MyTasks.php`:

```php
namespace Drupal\my_module\Plugin\Island;

use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;

#[Island(id: 'my_tasks', label: new TranslatableMarkup('My tasks'), type: 'view')]
final class MyTasks extends IslandPluginBase {

  public function build(array $data = [], array $options = []): array {
    $build = [];
    foreach ($data['tasks'] ?? [] as $task) {
      // Link primitive: fragment navigation, no reload.
      $build[] = $this->linkToRoute('my_module.task',
        ['task_id' => $task['id']], $task['title']);
      // Action link primitive: POST + CSRF mutation.
      $build[] = $this->action('delete', ['task' => $task['id']],
        'Delete', confirm: TRUE);
    }
    // Form primitive: mutations with input.
    $build['form'] = $this->getForm(TaskAddForm::class);
    return $build;
  }

}
```

Render it inside a stable wrapper on any page you own:

```php
use Drupal\island\IslandWrapper;

$island = \Drupal::service('plugin.manager.island')->createInstance('my_tasks');
$build['my_tasks'] = IslandWrapper::wrap($island->getHtmlId('my_host'),
$island->build(['tasks' => $tasks]));
$build['#attached']['library'][] = 'island/base';
```

A working example lives in `tests/modules/island_example` (the demo the
browser harness runs against).

## The three primitives

| Primitive | For | Author writes | Transport |
|---|---|---|---|
| **Link** | reads: navigation, filters, open detail | `$this->linkToRoute($route, $params, $label, $target)` or `$this->linkToPage(...)` — see below | GET; plain Drupal route + core fragment negotiation; a direct visit renders the full page with the same access checks |
| **Action link** | parameterless mutations: delete, toggle | `$this->action('delete', ['task' => $id], 'Delete', TRUE)` | POST + CSRF token to the page that shows the link, answered by `IslandActionSubscriber` before the page controller → `accessAction()` / `applyAction()` |
| **Form** | mutations with input: add, edit | `$this->getForm(TaskAddForm::class)` | POST through the Form API (token, validation, access) via `Drupal\island\Form\IslandFormBase` |

GET never mutates: an action is a POST to the current page URL carrying
`_island`, `_island_action`, `_island_host` and `_island_token` next to its
parameters. It runs after routing, so the page route's own access applies, and
in the page's request, so placement conditions see the real page.

Notes:

- CSRF tokens are session-seeded. Rendering an action link starts a persisted
  session for anonymous users (core never saves a metadata-only session), and
  pages containing action links must not be served from the internal page
  cache — set `options: { no_cache: 'TRUE' }` on host routes, as
  `island_example` does.
- An island form is re-rendered fresh after a successful submit: the consumed
  POST input is dropped before the fragment response is built, so embedded
  forms never resubmit.

## The two link builders, and how to choose

Whether a link is an HTMX link is a property of the **component that renders
it**, not of every link in the product. There is no global decoration and no
route-keyed table: an island writes its own links, and an internal link no
island renders is an ordinary link.

There are two builders, and the choice between them is not derivable — only the
component writing the link knows the answer:

```php
// Replace an island: its own by default, or a named peer.
$this->linkToRoute(
  $route, $params, $label, $target = NULL, $push_url = TRUE, $url_options = [],
);
//   → hx-get, hx-select + hx-target on $target ?? the island's own html id,
//     hx-swap: outerHTML

// Replace the CONTENTS of a container the page owns.
$this->linkToPage(
  $route, $params, $label, $target, $push_url = TRUE, $url_options = [],
);
//   → hx-get, hx-target on $target, hx-swap: innerHTML, and NO hx-select
```

**The one question that picks the builder:** does the thing being replaced live
in the response fragment, or only in the document? `hx-target` resolves against
the live document; `hx-select` resolves against the response. A Drupal HTMX
fragment is exactly the page's main content, so:

- An island, or any container a controller renders *inside* its result, is in
  the fragment → `linkToRoute()`, which selects it out of the response and
  replaces it whole.
- A container written by the **page template** is never in the fragment, because
  the fragment renderer does not run a page template at all → `linkToPage()`,
  which needs no selection and replaces the container's contents.

Getting this backwards is not a subtle bug: a `linkToPage()` link aimed at a
target that *is* in the fragment nests the whole page inside its own content
region, and a `linkToRoute()` link aimed at a page-owned container selects on an
id the response does not contain and swaps nothing.

The default target has the same failure mode one step further out: with no
`$target`, a `linkToRoute()` link addresses **its own island's html id**, so the
*destination* route has to render that island too — same host id, same plugin
id. Aim a defaulted link at a route where the island is absent and `hx-select`
finds nothing in the response, which empties the island instead of replacing
it. Name a target whenever the destination is not a page the island lives on.

`$url_options` is the third URL component after route and parameters — a query
string is a URL option, not a route parameter, which is what pagination links
need.

### The theme's half of the contract

The container a `linkToPage()` link targets **belongs to whoever owns the
page**. The module neither creates it nor knows its id, and nothing enforces
the pairing: if a theme renames the container, or a component targets one the
page does not have, the click does **nothing at all** — HTMX resolves
`hx-target` before
issuing the request and abandons it when it does not resolve, having already
cancelled the anchor's navigation. Writing the convention down is the only
enforcement there is.

A worked, executed example is
`tests/themes/island_e2e/templates/page.html.twig`, which the browser harness
runs on every pass:

```twig
<div id="page-content">{{ page.content }}</div>
```

Two consequences worth knowing before you rely on it:

- **The container is never itself replaced.** The swap is `innerHTML`, so it
  cannot be removed from the document and a later link on the page cannot become
  a dead click for want of a target.
- **`status_messages` arrives inside the container on a swap**, and in its own
  region on a full page load — the fragment body is messages plus main content,
  and all of it lands in the target. The same messages therefore appear in
  different places depending on how the page was reached.

Wrap **only** the main-content region. A container that also holds page chrome
would swallow that chrome on the first swap, because the fragment does not
contain it.

## Letting the client declare which islands render

A link can navigate by re-rendering a named set of islands instead of loading a
page — and it does so **without carrying a single attribute of its own**. The
declaration lives on the container; the client sends it with the request; the
server renders exactly what it was told. There is no route table, no comparison
against the previous page, no client state and no JavaScript.

**The island declares it, and every render asks the island.** Implement
`IslandInterface::boost()`; the default is `NULL`, which means an ordinary
container whose links are ordinary links.

```php
// A rail: its links swap the content region, and the rail rides along so its
// active entry is right afterwards. One request, two islands.
public function boost(): IslandBoost {
  return IslandBoost::to('#island-tasks-content');
}

// A content region: its links swap itself, and nobody else. One island.
public function boost(): IslandBoost {
  return IslandBoost::to();
}
```

`IslandWrapper::wrap()` applies it to the container it just built, and
`applyTo()` reads the container's own id out of that build — so the author
never repeats the id and never writes an attribute. `also()` exists for the
rarer case of naming a **third** island; the common case needs it never,
because a container targeting something else already declares itself.

There is deliberately **one author**. A host controller that applied a
declaration of its own would be a second one, and only the page build would
ever run it: the boosted GET path renders the same island through
`IslandGetSubscriber` without the controller being involved. That is exactly
how the first delivery of this mechanism broke — every swapped fragment came
back with no declaration on it, so a boosted navigation worked once per page
load and the next click was a full page load. `boost.spec.ts` now clicks
twice, and `IslandGetPathTest` asserts the attributes on both the main
fragment and the out-of-band peer.

**A placed Drupal block used to be a second author** — an "Island" fieldset on
the block configuration form wrote `island.enabled`, `island.boost` and
`island.swap_target` as third-party settings. It was withdrawn. The wrapper
that mechanism added from inside the block's lazy builder was the one thing
stopping the boosted GET path from root-rendering its fragments, and without
that pass a form in a swapped fragment carries an unresolved CSRF placeholder
and takes two clicks to submit. No block placement in the product had ever
opted in, so the mechanism was removed rather than worked around. Place an
island through an `island.profile.*`.

### Never write the two attributes by hand

`hx-select-oob` and the `X-Island-Also` header are two statements of one fact,
and htmx resolves them by **different** rules: `hx-headers` merges its
ancestors key by key, `hx-select-oob` is closest-wins and does not merge.
Authored separately they agree until either is nested and then diverge in
silence — the ancestor's island simply stops updating, with no error anywhere.

So `IslandBoost` derives both from one array and is the only place either may
be written. A guard enforces it:

- A `#pre_render` guard on the boosted container walks its own subtree and
  fails — `assert()` in development and test, a logger error in production —
  when a nested declaration drops one of its ancestor's selectors.

### What this does not do, on purpose

- **No link is touched.** `hx-boost` is inherited and htmx takes the anchor's
  own `href` as the path, so the anchor still works on a direct visit, a middle
  click and with JavaScript disabled. A plain menu block's markup is
  byte-identical to what it was.
- **No exclusion list exists.** htmx's own `isLocalLink()` already refuses a
  foreign hostname and an `href` beginning with `#`. Re-deriving that here
  would only produce something that disagrees with it at some edge.
- **The active entry can go stale.** A link *inside* the content island that
  leads into a different rail section leaves the rail's active entry pointing
  at where the visitor was. This is accepted rather than fixed: the alternative
  is putting the declaration back on the shell, which is the
  every-navigation-renders-the-menu cost this mechanism exists to avoid.
- **A fragment carries no assets.** The response is rendered HTML;
  `#attached` libraries do not become `<link>`/`<script>`. An island whose
  content needs a library that is not already on the page renders unstyled.
  This is the mutation path's existing behaviour, not a new limit.
- **Only boosted requests are answered this way.** htmx sends `HX-Boosted` when
  and only when the request came from a boosted element, and that is the exact
  condition. The two link builders below are ordinary core htmx fragment
  requests and are answered by core, title and all.

### Both caches are bypassed, and why a cache buster is not used

`island.page_cache_request_policy` denies a request carrying both `HX-Request`
and `HX-Target`, and it is tagged for the internal page cache **and** the
dynamic page cache. Both key on the url without varying on any htmx header, so
without it a boosted GET would be answered from a stored full page, and its own
fragment would be stored under that page's url for the next plain visitor.

`setMaxAge(0)` is not an alternative — the page cache ignores max age and
stores any cacheable response.

htmx's `getCacheBusterParam` also works against this, is cheaper, and is
deliberately **not** used. Its value is the target id alone, so two links to the
same url with the same target but different also-lists would share one cache
key; it makes the key different rather than the response uncacheable, so
fragments accumulate under urls nobody requests; and `htmx.config` is site-wide.
It remains available as a site-level lever, and this module does not lean on it
for correctness.

## Entity forms as islands

`IslandFormBase` extends `FormBase`. Entity forms extend `ContentEntityForm`,
so the island wiring also exists as `Drupal\island\Form\IslandFormTrait` —
the same three methods (`resolveIsland()`, `attachIslandHtmx()`,
`respondIsland()`) reusable on any form base class. Wire the three island
services in `create()`, attach the HTMX attributes in `form()`, and respond
after `parent::save()`:

```php
final class NoteForm extends ContentEntityForm {
  use IslandFormTrait;

  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    $this->attachIslandHtmx($form, $form_state);
    return $form;
  }

  public function save(array $form, FormStateInterface $form_state): int {
    $status = parent::save($form, $form_state);
    $this->respondIsland($form_state, IslandResponse::make()->rebuildSelf()
      ->dispatch('notes.changed', ['id' => $this->entity->id()]));
    return $status;
  }
}
```

The hosting island embeds the entity form with the island build args, exactly
like `getForm()` does for plain forms:

```php
$form_object = $this->entityTypeManager->getFormObject('my_entity', 'edit');
$form_object->setEntity($entity);
$build['form'] = $this->formBuilder->getForm($form_object, [
  'island_id' => 'note',
  'host_id' => $this->hostId(),
]);
```

`respondIsland()` carries the same consumed-POST-input handling as
`IslandFormBase`, so the re-rendered island never re-processes the submitted
input. Validation failures re-render the form island with the errors, like
any Form API form; suppress the HTML5 `required` attribute on elements that
must reach server-side validation, because the browser would otherwise block
the HTMX submit natively (see `island_example`'s `NoteForm`).

**`validateIslandForm(array &$form, FormStateInterface $form_state,
IslandInterface $island)` takes `$form` BY REFERENCE.**
`FormBuilder::processForm()` builds the form
before it validates and never rebuilds one that ends validation with an
error, so a rejected submit is answered with the array the BUILD produced —
before any error existed to show. A subclass that needs the refusal visible
in that same response (a message slot the build had no reason to add) has to
mutate `$form` inside `validateIslandForm()` itself; nothing later
reconstructs it. A subclass that only calls `$form_state->setErrorByName()`
is unaffected — a by-reference parameter costs a caller nothing it does not
use. `bb_core`'s `TeamMemberAddForm::validateIslandForm()` is the worked
example: it writes its own message straight onto `$form` when the addition is
refused.

## A form island must live inside its route's main content

A route's main content is not the whole page. A dialog rendered in a page
shell's overlay region, say, is a SIBLING of the region core's
`_wrapper_format=drupal_htmx` renderer assembles — and an island form
living there never gets built by that renderer at all, so Form API never
sees its POST: not validated, not submitted, not refused. Two request kinds
resolve an island by the html id the client named, rather than by the
matched route, to cover this:

- **GET, cacheable, boosted.** `IslandGetSubscriber` (`kernel.view`) answers
  a boosted navigation: the target plus whatever `X-Island-Also` names.
- **POST, and everything else that mutates.** Nothing here, deliberately.
  This module carried a second view subscriber that built the addressed
  island directly on a mutating request, so that a form living outside main
  content could see its own POST. It was deleted, and
  not because the problem went away: the problem has a better answer. Give
  the surface a ROUTE, and its form IS main content — validated, refused and
  re-rendered by Form API with nothing of this module involved. An island
  form therefore belongs INSIDE its route's main content; the team-members
  island is the shape that works.

`IslandFragmentResolver` is where a client-supplied html id is turned into a
fragment, and the one place the visitor is asked whether they may see it
(`IslandViewAccessInterface::accessIsland()`).

## IslandResponse: the mutation contract

`applyAction()` and `submitIslandForm()` return one fluent value object:

```php
return IslandResponse::make()
  ->rebuildSelf()                       // the triggering island (main fragment)
  ->rebuild(['task_count'])              // explicit peers, out-of-band
  ->dispatch('tasks.changed', $payload) // subscribed peers rebuild, OOB
  ->triggerClientEvent('drawer:close')   // HX-Trigger header (JS side effect)
  ->location($url);                      // HX-Location header (client redirect)
```

All peer fragments are computed **in the same request** (one round trip,
cache metadata bubbles through the normal render pipeline). Islands opt into
events:

```php
public function getSubscribedEvents(): array {
  return ['tasks.changed' => 'onTasksChanged'];
}

public function onTasksChanged(IslandEvent $event): ?array {
  // Return a render array (OOB fragment) or NULL (island untouched —
  // NULL never emits markup).
  return ['#markup' => 'Tasks: ' . $event->payload['count']];
}
```

A response that is not an island response (a form's own swap, say) can
announce an event to the browser instead: it names the event in `HX-Trigger`.
Every subscribed island container lists its events in `data-island-events`,
and `js/island.events.js` re-renders each subscriber with the boosted GET of
the current page, so the island is built in its own route context. Server
fan-out and browser announcements share one event namespace: a placement's
`events` answer both, so name an event for what happened, not for its
transport.

## Hosting islands: the context seam

A mutation response needs to know which islands a page hosts. Register one
tagged service per host:

```yaml
services:
  my_module.task_host:
    class: Drupal\my_module\TaskHostProvider
    tags:
      - { name: island.context_provider }
```

```php
interface IslandContextProviderInterface {
  public function hostId(): string;                            // 'tasks'
  public function getIslandIds(): array;  // enabled islands
  public function getIslandConfiguration(string $island_id): array;
  public function getIslandData(string $island_id): array;     // build() input
}
```

Those four methods are the whole host contract for the page build and the
mutation path. **A host whose islands should be reachable by a boosted link
implements one more interface**, and a host that skips it is not broken — its
islands simply never answer a boosted GET:

```php
interface IslandViewAccessInterface {
  public function accessIsland(
    string $island_id,
    AccountInterface $account,
  ): AccessResultInterface;
}
```

The reason is worth a sentence, because the silence is deliberate. A boosted
GET names its island by **html id in a request header**, and the resolver
parses that id and asks the registered hosts — a walk that is deliberately
*not* scoped to the current route, since scoping it would be the route
inference this design exists to avoid. Nothing else on that path knows whether
the visitor was ever entitled to see what they named. So the host says, per
island, and a host that says nothing is **forbidden** rather than open: a leak
by omission is the failure mode this closes, and it would otherwise reappear
with every host written after this one. Return an `AccessResult` carrying the
contexts and tags the decision depends on — they ride onto the fragment
response, so a fragment rendered under a permission check is not later handed
from a cache to somebody without it.

An island is **rebuilt, never
remembered**: `getIslandData()` is asked again for the request being served, the
way a menu block computes its active trail on every page build. The only thing
that persists between two responses is the stable DOM id, and an id is an
address, not state.

`IslandInterface::build()` never receives the host — data flows as plain
arrays; the host is available to the plugin via configuration contexts when
created through the host (`$config['contexts']['host'] = $provider`).
`getHtmlId($host_id)` keeps the OOB-stable wrapper id convention
`island-<host>-<plugin>`.

Island types are plain strings (`type: 'view'`); hosts register and own their
types and placement storage. `hook_island_info_alter()` and
`hook_island_types_alter()` are the extension points.

## Block islandification — removed

A placed Drupal block used to be able to become an island in its own block
configuration form: an "Island" fieldset writing `island.enabled`,
`island.boost` and `island.swap_target` as third-party settings, a
`hook_block_view_alter` that wrapped the opted-in block, an `island.block`
route that re-rendered one on its own, and an `island_block` plugin for the
same thing where no placement existed. **All of it is gone.**

It was removed rather than repaired because it was the sole obstacle to
root-rendering a boosted GET fragment. The wrapper arrived from inside the
block's lazy builder, so a root pass produced two nested elements carrying one
id — and *without* the root pass a form in that fragment carries an unresolved
CSRF placeholder, Drupal refuses the token, and the write happens only on the
second click. Weighed against that, the block mechanism had no production use
at all: no `block.block.*` in `config/sync`, in `recipes/`, in any custom
module, or on the develop or prod environments had ever opted in.

Place an island through an `island.profile.*`. To render a block *plugin*
inside one, the `block` island plugin takes `plugin_id` and `configuration`.
A stale `third_party_settings.island` key on a block entity is simply unread;
nothing errors and the block renders as an ordinary block.
`BlockIslandificationRemovedTest` pins that absence.

`IslandWrapper` containers are unconditional. An island's `build()` returns a
list with no root element, so it has nowhere to hang an id of its own.

## Migrating from Display Builder

Display Builder (`drupal/display_builder`) keeps its entity-view and editor
features, while page composition can be represented by the shared App/Profile
model. Class-level mapping:

| Display Builder | Island module |
|---|---|
| `IslandInterface::build(InstanceInterface $builder, …)` | `Drupal\island\IslandInterface::build(array $data = [], array $options = [])`; the host flows via `createInstance($id, ['contexts' => ['host' => $provider]])` |
| `IslandPluginBase` (ui_patterns/SDC injection) | `Drupal\island\IslandPluginBase` (core services only; SDCs usable inside `build()` without module support) |
| `HtmxTrait` (`addOutOfBand`/`makeOutOfBand`/`addTarget`/`setTrigger`) | `IslandWrapper` + `IslandResponder` + core `Drupal\Core\Htmx\Htmx` helpers |
| `HtmxEvents` (hardcoded `display_builder.api_*` routes, JS callbacks) | the three primitives + `IslandResponse::dispatch()` server-computed fan-out |
| `IslandWithFormInterface/Trait` + `Form\IslandFormBase` (delegating) | `Drupal\island\Form\IslandFormBase` (subclass; `submitIslandForm(): IslandResponse`) |
| `IslandConfigurationFormInterface/Trait` | island plugin `getConfiguration()` as usual; placement storage is host-owned |
| Profile-sourced island set + `IslandType` enum | string `type` + `hook_island_types_alter()` + host-owned placement storage |
| SSE collaboration (`ApiSseController`, `htmx_sse`) | out of scope; the `getHtmlId()` convention leaves the door open for a later `island_sse` |

An App identifies its owning integration and an Island Profile owns the SDC
layout plus stable placement records. bakers.build's page app uses the
standalone `default` provider, selected by `island.settings.page_app`. The
optional `island_ui_patterns` submodule supplies component/source mapping; the
base module remains usable without UI Patterns. Display Builder entity-view
rendering remains available separately.

`island.profile_migrator` migrates legacy page layouts. The migrator reads
legacy active configuration directly, validates the entire batch, and creates
equivalent profiles in the `bakers` app. It preserves enabled state, priority,
request paths, literal root props, component source trees, block settings, and
stable source/wrapper identities. Leading blocks and controller content inside a
legacy content wrapper become one Page Content placement with `prefix_blocks`,
so tabs refresh together with the page body. Wrapper target references become
placement references scoped to the rendered profile instance.

Unrecognised sources, missing dependencies, negated/unknown conditions, dynamic
root mappings and conflicting destination profiles abort migration with the
source config name and a repair instruction. Original layouts are retained.
Repeating a successful migration creates no duplicates and changes no IDs.
The uninstall validator blocks removal of `display_builder_page_layout` until
all source records have matching saved profiles. During the import that retires
the old provider, an import transformation preserves those migrated profiles
and their app instead of overwriting customised settings with shipped defaults.
Export the resulting configuration for subsequent normal deployments; after the
legacy source configuration is gone, ordinary configuration import applies.

Fresh recipe and CIM installations ship the same standalone app/profiles and
no longer install the old page-layout module.

## Testing

```bash
# Unit/kernel suite (plugin API, responder, routes, forms, blocks):
ddev exec vendor/bin/phpunit -c phpunit.xml web/modules/custom/island/tests/src

# Browser harness (minimal SQLite install, php -S, Chromium):
ddev exec web/modules/custom/island/tests/e2e/run.sh <evidence-dir>

# File-observable contracts (no DDEV, no build — reads of repository content):
bash tests/contract/island-links.sh
```

The evidence directory is required: it belongs under the calling ticket's
transient root, and a generic harness has no way to know which ticket a run
belongs to.

The browser harness installs a minimal site into `web/sites/island_e2e`, enables
the `island_e2e` theme and makes it default, enables `island` +
`island_example`, serves it on `127.0.0.1:8973`, and runs one spec per
primitive. Everything is torn down afterwards.

`tests/themes/island_e2e` exists because the theme's half of the contract above
cannot be demonstrated by a module: it is the page template that writes
`#page-content`, and a module writing it would be the module reaching into page
rendering — the thing this design deliberately does not do.
