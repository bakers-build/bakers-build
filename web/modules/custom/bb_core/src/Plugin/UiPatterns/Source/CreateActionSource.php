<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\TitleResolverInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Routing\RouteProviderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\Core\Utility\Token;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\Entity\SampleEntityGeneratorInterface;
use Drupal\ui_patterns\PropTypePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\UiPatternsNormalizerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Exception\RouteNotFoundException;
use Symfony\Component\Routing\Route;

/**
 * The affordance that opens one create dialog over the screen it is placed on.
 *
 * Configured with the dialog route; the differences between create subjects
 * are settings. The trigger is offered exactly when the dialog route's own
 * access check allows it, so affordance and route cannot disagree, and it
 * carries the route's title unless a `label` is set.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 * @SuppressWarnings("PHPMD.CouplingBetweenObjects")
 */
#[Source(
  id: 'bb_create_action',
  label: new TranslatableMarkup('[bakers.build] Create action'),
  description: new TranslatableMarkup('Opens the create dialog of the configured route over the current screen.'),
  prop_types: ['slot'],
)]
class CreateActionSource extends SourcePluginBase {

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
    protected readonly RouteProviderInterface $routeProvider,
    protected readonly TitleResolverInterface $titleResolver,
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
      $container->get('router.route_provider'),
      $container->get('title_resolver'),
    );
  }

  /**
   * {@inheritdoc}
   *
   * - `route`: the dialog route.
   * - `screens`: route names the trigger appears on; a trailing `*` matches a
   *   prefix; empty means every route.
   * - `route_parameters`: fixed dialog route parameters, over the screen's own
   *   raw parameters of the same name.
   * - `query`: screen query keys forwarded to the dialog; `*` forwards all.
   * - `route_query`: dialog query key => screen route parameter, sent as the
   *   converted entity's id; it wins over a forwarded key.
   * - `trigger_id`: the trigger's element id, for a dialog that returns focus.
   * - `label`: the trigger's label; empty uses the dialog route's title.
   *
   * @return array<string, mixed>
   *   The default settings.
   */
  public function defaultSettings(): array {
    return [
      'route' => '',
      'screens' => [],
      'route_parameters' => [],
      'query' => [],
      'route_query' => [],
      'trigger_id' => '',
      'label' => '',
    ];
  }

  /**
   * {@inheritdoc}
   *
   * The sequences and mappings are edited in the profile's config only: they
   * name route parameters and query keys, which no widget can offer.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The form.
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    foreach (['route' => $this->t('Dialog route'), 'trigger_id' => $this->t('Trigger id'), 'label' => $this->t('Label')] as $key => $title) {
      $form[$key] = [
        '#type' => 'textfield',
        '#title' => $title,
        '#default_value' => $this->getSetting($key),
      ];
    }
    return $form;
  }

  /**
   * The route the dialog lives at.
   */
  protected function dialogRoute(): string {
    return (string) $this->getSetting('route');
  }

  /**
   * The dialog route's parameters, or NULL when this screen cannot fill them.
   *
   * Each path variable takes the screen's raw parameter of the same name, so
   * the dialog opens in the screen's workspace, project or team; the
   * `route_parameters` setting overlays them.
   *
   * @return array<string, string>|null
   *   Route parameters, or NULL for an unknown route or an unfilled variable.
   */
  protected function dialogRouteParameters(): ?array {
    $route = $this->dialogRouteObject();
    if (!$route instanceof Route) {
      return NULL;
    }
    $variables = array_flip($route->compile()->getPathVariables());
    $parameters = array_intersect_key((array) $this->getSetting('route_parameters') + $this->routeMatch->getRawParameters()->all(), $variables);
    $missing = array_diff_key($variables, $parameters, $route->getDefaults());
    return $missing === [] ? array_map('strval', $parameters) : NULL;
  }

  /**
   * The dialog route, or NULL when none is configured or it does not exist.
   */
  private function dialogRouteObject(): ?Route {
    $name = $this->dialogRoute();
    if ($name === '') {
      return NULL;
    }
    try {
      return $this->routeProvider->getRouteByName($name);
    }
    catch (RouteNotFoundException) {
      return NULL;
    }
  }

  /**
   * The label the trigger carries, which is its accessible name.
   *
   * `icon_only => TRUE` moves it into `aria-label` (`button.twig`), so this is
   * what a screen reader announces and what `getByRole('link', …)` matches.
   */
  private function triggerLabel(Route $route): string {
    $label = (string) $this->getSetting('label');
    if ($label !== '') {
      return $label;
    }
    $title = $this->titleResolver->getTitle(new Request(), $route);
    return is_array($title) ? (string) ($title['#markup'] ?? '') : (string) $title;
  }

  /**
   * Sets the trigger's id on its attributes, when it has one.
   */
  private function withTriggerId(Attribute $attributes): Attribute {
    $id = (string) $this->getSetting('trigger_id');
    return $id === '' ? $attributes : $attributes->setAttribute('id', $id);
  }

  /**
   * Whether this trigger belongs on the current route.
   *
   * The shell page-header island offers every create source; each source
   * keeps itself off screens it does not own.
   */
  private function appliesToCurrentRoute(): bool {
    $screens = (array) $this->getSetting('screens');
    $current = (string) $this->routeMatch->getRouteName();
    foreach ($screens as $screen) {
      $screen = (string) $screen;
      if (str_ends_with($screen, '*') ? str_starts_with($current, substr($screen, 0, -1)) : $screen === $current) {
        return TRUE;
      }
    }
    return $screens === [];
  }

  /**
   * {@inheritdoc}
   *
   * The cache contexts are declared above the branch because the empty
   * answer depends on `user.permissions` and the route too; `url` because
   * both addresses are derived from the request.
   *
   * @return array<string, mixed>
   *   The trigger; cache metadata alone when the account may not create the
   *   subject, which renders to nothing.
   */
  public function getPropValue(): mixed {
    $build = ['#cache' => ['contexts' => ['user.permissions', 'url', 'route']]];
    $route = $this->dialogRouteObject();
    $parameters = $this->dialogRouteParameters();
    if (!$route instanceof Route || $parameters === NULL || !$this->appliesToCurrentRoute()) {
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
        'label' => $this->triggerLabel($route),
        'href' => $this->dialogUrl($parameters, FALSE)->toString(),
        'variant' => 'primary',
        'icon_only' => TRUE,
        'attributes' => $this->withTriggerId((new Htmx())
          ->get($this->dialogUrl($parameters, TRUE))
          ->target('#' . static::TARGET_ID)
          // Stated, never inherited: the content island's inherited
          // `hx-select` would otherwise swap in nothing. `dialog`, not the
          // form or an id, because the hull wraps the form and only the
          // element is common to both hulls. Only the outermost: htmx swaps in
          // every match, which would lift a nested dialog, such as the image
          // crop's, out of its form.
          ->select('dialog:not(dialog dialog)')
          ->swap('innerHTML')
          ->getAttributes()),
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
   * A MERGE, NEVER A SUFFIX: the forwarded screen keys go in first, the
   * route-bound ones over them, and `destination` is written over the top, so
   * a screen that already carried one cannot smuggle it in as the dialog's.
   * Forwarded values are copied, not checked: the add forms revalidate them.
   *
   * @param array<string, string> $parameters
   *   The dialog route's parameters.
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
  private function dialogUrl(array $parameters, bool $through_the_format): Url {
    $query = $this->routeBoundQuery() + $this->forwardedQuery();
    $query[static::RETURN_PARAMETER] = $this->currentAddress();
    if ($through_the_format) {
      $query[static::WRAPPER_FORMAT_PARAMETER] = static::WRAPPER_FORMAT_VALUE;
    }

    return Url::fromRoute($this->dialogRoute(), $parameters, ['query' => $query]);
  }

  /**
   * The screen's query keys the `query` setting forwards.
   *
   * `*` forwards facet values too, because `PickerWidget` reads a field's
   * opening value off the query key its `context_parameter` names.
   *
   * @return array<string, mixed>
   *   Query keys and values.
   */
  private function forwardedQuery(): array {
    $keys = (array) $this->getSetting('query');
    $query = $keys === [] ? [] : $this->screenQuery();
    return in_array('*', $keys, TRUE) ? $query : array_intersect_key($query, array_flip($keys));
  }

  /**
   * Route parameters that must win over any forwarded screen query.
   *
   * A project-bound screen carries its project as a ROUTE parameter, which the
   * query never sees; its converted id is sent, because the add forms accept
   * ids only while the raw slot may hold a key or UUID.
   *
   * @return array<string, string>
   *   Dialog query keys and values.
   */
  private function routeBoundQuery(): array {
    $query = [];
    foreach ((array) $this->getSetting('route_query') as $key => $name) {
      $value = $this->routeMatch->getParameter((string) $name);
      if ($value instanceof EntityInterface) {
        $value = $value->id();
      }
      if (is_scalar($value)) {
        $query[$key] = (string) $value;
      }
    }
    return $query;
  }

  /**
   * Offers the trigger exactly when the dialog route itself would be allowed.
   */
  protected function createAccess(): AccessResultInterface {
    $route_access = Url::fromRoute($this->dialogRoute(), $this->dialogRouteParameters() ?? [])
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
