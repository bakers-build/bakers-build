<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\Core\Utility\Token;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\ui_patterns\Entity\SampleEntityGeneratorInterface;
use Drupal\ui_patterns\PropTypePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\UiPatternsNormalizerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * The affordance that opens one create dialog over the screen it is placed on.
 *
 * Shares the dialog format plumbing, URL building and htmx declaration across
 * the create subjects. The trigger is offered exactly when the dialog route's
 * own access check allows it, so affordance and route cannot disagree.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
abstract class CreateActionSourceBase extends SourcePluginBase {

  /**
   * The query parameter carrying the screen the dialog is opened over.
   *
   * Core's own name, which `RedirectResponseSubscriber` honours on the
   * no-JavaScript path with nothing added, and which
   * `WrappedDialogFormTrait::returnUrl()` reads back on the htmx one. Stated
   * here rather than shared WITH THAT TRAIT for the reason the trait states
   * about its own literals: the two ends agree on core's name by necessity
   * rather than by sharing a dependency, and `island` may not depend on
   * bb_core in the other direction at all.
   */
  protected const string RETURN_PARAMETER = 'destination';

  /**
   * The registered `_wrapper_format` that answers with the dialog hull.
   *
   * `island`'s OWN format (`island.services.yml`), not a second one of ours:
   * `bb_theme:dialog` reaches this request by declaring
   * `replaces: island:dialog` in its own `component.yml`, which is core SDC's
   * override mechanism, so no bb_core registration is needed for the theme's
   * hull to be what actually renders. `BbDialogWrapperFormatTest` asserts the
   * registry entry against this string, so a drift fails a test instead of
   * degrading silently to `html`.
   */
  protected const string WRAPPER_FORMAT_VALUE = 'island_dialog';

  /**
   * The query parameter core reads to pick a main-content renderer.
   */
  protected const string WRAPPER_FORMAT_PARAMETER = '_wrapper_format';

  /**
   * The DOM id of the shell region every response of this format is swapped in.
   *
   * The only place in PHP that names the target: create forms rely on
   * `shell.twig`'s `#bakers-overlay` wrapper carrying `hx-target="this"`. Tests
   * read this constant, so a rename fails them instead of drifting silently
   * against `shell.twig`'s hard-coded id.
   */
  public const string TARGET_ID = 'bakers-overlay';

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    PropTypePluginManager $propTypeManager,
    ContextRepositoryInterface $contextRepository,
    RouteMatchInterface $routeMatch,
    SampleEntityGeneratorInterface $sampleEntityGenerator,
    ModuleHandlerInterface $moduleHandler,
    Token $token,
    UiPatternsNormalizerInterface $normalizer,
    protected readonly AccountInterface $currentUser,
    protected readonly RequestStack $requestStack,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition, $propTypeManager, $contextRepository, $routeMatch, $sampleEntityGenerator, $moduleHandler, $token, $normalizer);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(
    ContainerInterface $container,
    array $configuration,
    $plugin_id,
    $plugin_definition,
  ): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('plugin.manager.ui_patterns_prop_type'),
      $container->get('context.repository'),
      $container->get('current_route_match'),
      $container->get('ui_patterns.sample_entity_generator'),
      $container->get('module_handler'),
      $container->get('token'),
      $container->get('ui_patterns.normalizer'),
      $container->get('current_user'),
      $container->get('request_stack'),
    );
  }

  /**
   * The route the dialog lives at.
   *
   * @return string
   *   A route name, resolved with no parameters — the workspace segment is
   *   filled in by `BbWorkspaceRouteProcessor` from the route the request
   *   matched, so no subject states which workspace it is in.
   */
  abstract protected function dialogRoute(): string;

  /**
   * The label the trigger carries, which is its accessible name.
   *
   * `icon_only => TRUE` moves it into `aria-label` (`button.twig`), so this is
   * what a screen reader announces and what `getByRole('link', …)` matches.
   *
   * @return string
   *   The translated label.
   */
  abstract protected function triggerLabel(): string;

  /**
   * Whether the screen's own query is merged into the dialog's address.
   *
   * TRUE forwards the whole query, facet values included, because
   * `PickerWidget` reads a field's opening value off the query key its
   * `context_parameter` names. FALSE suits a dialog with no context field.
   * Either way the screen's query survives inside `destination`
   * ({@see currentAddress()}).
   *
   * @return bool
   *   TRUE to merge the screen's query into the dialog's own.
   */
  abstract protected function forwardsScreenQuery(): bool;

  /**
   * Route parameters for a dialog route that has its own placeholders.
   *
   * Empty for workspace-prefixed routes, whose segment
   * `BbWorkspaceRouteProcessor` fills in.
   *
   * @return array<string, int|string>
   *   Route parameters.
   */
  protected function dialogRouteParameters(): array {
    return [];
  }

  /**
   * Values the add form opens with, beside the destination.
   *
   * The form revalidates them; a subclass passes only what it has checked.
   *
   * @return array<string, string>
   *   Query values.
   */
  protected function prefill(): array {
    return [];
  }

  /**
   * A route parameter's value that must win over any forwarded screen query.
   *
   * A project-bound screen (for example the per-project ticket list) carries
   * its project as a ROUTE parameter, which {@see forwardsScreenQuery()}
   * never sees — that method only ever forwards the request's query string.
   * A subject whose dialog must bind to that project overrides this to read
   * the route parameter and name the dialog query key it corresponds to
   * (`['project' => '42']`); the merge in {@see dialogUrl()} applies it AFTER
   * both the forwarded query and {@see prefill()}, so a stale or conflicting
   * facet in either can never win over the route the dialog was actually
   * opened from.
   *
   * @return array<string, string>
   *   Query keys/values to force onto the dialog address; empty when this
   *   screen carries no such route-scoped context.
   */
  protected function routeBoundQuery(): array {
    return [];
  }

  /**
   * Whether this trigger belongs on the current route.
   *
   * The shell page-header island offers every create source; each source
   * keeps itself off screens it does not own.
   */
  protected function appliesToCurrentRoute(): bool {
    return TRUE;
  }

  /**
   * {@inheritdoc}
   *
   * The cache contexts are declared above the branch because the empty
   * answer depends on `user.permissions` too; `url` because both addresses
   * are derived from the request.
   *
   * @return array<string, mixed>
   *   The trigger; cache metadata alone when the account may not create the
   *   subject, which renders to nothing.
   */
  public function getPropValue(): mixed {
    $build = ['#cache' => ['contexts' => ['user.permissions', 'url']]];
    if (!$this->appliesToCurrentRoute()) {
      return $build;
    }
    $access = $this->createAccess();
    CacheableMetadata::createFromObject($access)->merge(CacheableMetadata::createFromRenderArray($build))->applyTo($build);
    if (!$access->isAllowed()) {
      return $build;
    }

    $build += [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      // Only the `Htmx` attributes are used (they go on a prop), so its
      // library is stated here, with the option picker's: the dialog's own
      // libraries arrive too late for the first click.
      '#attached' => [
        'library' => [
          'core/drupal.htmx',
          'core/components.bb_theme--option_picker',
        ],
      ],
      '#props' => [
        'label' => $this->triggerLabel(),
        'href' => $this->dialogUrl(FALSE)->toString(),
        'variant' => 'primary',
        'icon_only' => TRUE,
        'attributes' => (new Htmx())
          ->get($this->dialogUrl(TRUE))
          ->target('#' . static::TARGET_ID)
          // Stated, never inherited: the content island's inherited
          // `hx-select` would otherwise swap in nothing. `dialog`, not the
          // form or an id, because the hull wraps the form and only the
          // element is common to both hulls. Only the outermost: htmx swaps in
          // every match, which would lift a nested dialog, such as the image
          // crop's, out of its form.
          ->select('dialog:not(dialog dialog)')
          ->swap('innerHTML')
          ->getAttributes(),
      ],
      '#slots' => [
        'icon' => [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          '#props' => [
            'name' => 'plus',
            'size' => 'sm',
          ],
        ],
      ],
    ];

    return $build;
  }

  /**
   * The dialog route, carrying this screen's address and its subject's policy.
   *
   * `Url::fromRoute()` and not `fromUserInput()`: the workspace segment is
   * filled in by `BbWorkspaceRouteProcessor` from the route the request
   * matched, so this method never states which workspace it is in.
   *
   * A MERGE, NEVER A SUFFIX, where {@see forwardsScreenQuery()} is TRUE: the
   * screen's keys go in first and `destination` is written over the top, so a
   * screen that already carried one cannot smuggle it in as the dialog's.
   *
   * @param bool $through_the_format
   *   TRUE for the `hx-get` address, which carries the wrapper format and is
   *   answered with the hull alone; FALSE for the plain `href` a browser with
   *   no JavaScript follows to a whole page.
   *
   * @return \Drupal\Core\Url
   *   The address the trigger points at.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  private function dialogUrl(bool $through_the_format): Url {
    $query = [];
    if ($this->forwardsScreenQuery()) {
      $query = $this->screenQuery();
    }

    $query = $this->prefill() + $query;
    // The route's own context wins over a conflicting forwarded facet or
    // prefill.
    $query = $this->routeBoundQuery() + $query;
    $query[static::RETURN_PARAMETER] = $this->currentAddress();
    if ($through_the_format) {
      $query[static::WRAPPER_FORMAT_PARAMETER] = static::WRAPPER_FORMAT_VALUE;
    }

    return Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters(), ['query' => $query]);
  }

  /**
   * Offers the trigger exactly when the dialog route itself would be allowed.
   */
  protected function createAccess(): AccessResultInterface {
    $workspace = $this->routeMatch->getParameter('bb_workspace');
    if (!$workspace instanceof BbWorkspaceInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    $route_access = Url::fromRoute($this->dialogRoute(), ['bb_workspace' => $workspace->getSlug()])
      ->access($this->currentUser, TRUE);
    return AccessResult::allowed()->addCacheContexts(['route'])->andIf($route_access);
  }

  /**
   * The screen this trigger is rendered on, as a root-relative address.
   *
   * Read off the request rather than off `Url::fromRoute('<current>')`, which
   * depends on a matched route this method has no need to assume — the same
   * reasoning `WrappedDialogFormTrait` gives for reading its own return url off
   * the request. The screen's OWN query is kept, because the reader chose it
   * and `Cancel` has to land back on the list they were looking at; it rides
   * inside `destination` percent-encoded, which is what keeps it out of the
   * dialog's own query.
   *
   * Neither `destination` nor the format is carried into it: a nested
   * destination is an address the reader never chose, and the format belongs
   * to the dialog's request.
   */
  private function currentAddress(): string {
    $request = $this->requestStack->getCurrentRequest();
    $path = $request?->getPathInfo() ?? '/';
    $query = $this->screenQuery();
    $suffix = $query === [] ? '' : '?' . UrlHelper::buildQuery($query);

    return ($path === '' ? '/' : $path) . $suffix;
  }

  /**
   * The query the reader chose for this screen, without the transport keys.
   *
   * A nested `destination` is an address the reader never chose and the
   * format belongs to the dialog's request. `ajax_page_state` is added to
   * every htmx GET by `htmx-assets.js`, and core's asset resolver reads it as
   * "already loaded": an address carrying it lands on a page without its
   * libraries. The other keys are core's AJAX request markers.
   *
   * @return array<string, mixed>
   *   The current request's query, minus the transport keys.
   */
  private function screenQuery(): array {
    $query = $this->requestStack->getCurrentRequest()?->query->all() ?? [];
    unset(
      $query[static::RETURN_PARAMETER],
      $query[static::WRAPPER_FORMAT_PARAMETER],
      $query['ajax_page_state'],
      $query['_drupal_ajax'],
      $query['_triggering_element_name'],
      $query['_triggering_element_value'],
    );

    return $query;
  }

}
