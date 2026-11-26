<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Access\AccessManagerInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Menu\LocalActionInterface;
use Drupal\Core\Menu\LocalActionManagerInterface;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Routing\RouteProviderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Url;
use Drupal\Core\Utility\Token;
use Drupal\bb_core\Menu\CreateActionAccessInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\Entity\SampleEntityGeneratorInterface;
use Drupal\ui_patterns\PropTypePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\UiPatternsNormalizerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * The affordances that open create dialogs over the screen they are placed on.
 *
 * Renders the screen's local actions that carry a `dialog` key, each as one
 * round plus. The action says where it appears (`appears_on`), what it is
 * called (`title`) and which dialog it opens (`route_name`,
 * `route_parameters`); its `dialog` key adds `query` (screen keys forwarded,
 * `*` for all), `route_query` (dialog key => screen route parameter, sent as
 * the converted id) and `trigger_id`. A trigger is offered exactly when the
 * dialog route's own access check allows it, ANDed with the action's own
 * check when its class implements CreateActionAccessInterface.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 * @SuppressWarnings("PHPMD.CouplingBetweenObjects")
 */
#[Source(
  id: 'bb_create_action',
  label: new TranslatableMarkup('[bakers.build] Create actions'),
  description: new TranslatableMarkup('Opens the create dialogs of the current screen, from its dialog local actions.'),
  prop_types: ['slot'],
)]
final class CreateActionSource extends SourcePluginBase {

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
  private const string RETURN_PARAMETER = 'destination';

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
  private const string WRAPPER_FORMAT_VALUE = 'island_dialog';

  /**
   * The query parameter core reads to pick a main-content renderer.
   */
  private const string WRAPPER_FORMAT_PARAMETER = '_wrapper_format';

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
    protected readonly LocalActionManagerInterface $localActions,
    protected readonly AccessManagerInterface $accessManager,
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
      $container->get('plugin.manager.menu.local_action'),
      $container->get('access_manager'),
    );
  }

  /**
   * {@inheritdoc}
   *
   * `action`: one local action id rendered on every screen (the rail's team
   * plus); empty renders the current screen's dialog actions.
   *
   * @return array<string, mixed>
   *   The default settings.
   */
  public function defaultSettings(): array {
    return ['action' => ''];
  }

  /**
   * {@inheritdoc}
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
    $form['action'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Local action'),
      '#description' => $this->t('Empty renders the dialog actions of the current screen.'),
      '#default_value' => $this->getSetting('action'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * The cache contexts are declared up front because an empty answer depends
   * on `user.permissions` and the route too; `url` because both addresses are
   * derived from the request.
   *
   * @return array<string, mixed>
   *   One trigger per offered action, keyed by action id, plus cache metadata.
   */
  public function getPropValue(): mixed {
    $build = ['#cache' => ['contexts' => ['user.permissions', 'url', 'route']]];
    $cacheability = CacheableMetadata::createFromRenderArray($build);
    foreach ($this->dialogActions() as $id => $definition) {
      $trigger = $this->trigger($id, $definition['dialog'], $cacheability);
      if ($trigger !== NULL) {
        $build[$id] = $trigger;
      }
    }
    $cacheability->applyTo($build);
    return $build;
  }

  /**
   * The dialog local actions to offer: the `action` setting's, or the screen's.
   *
   * @return array<string, array<string, mixed>>
   *   Definitions by id, in weight order.
   */
  private function dialogActions(): array {
    $only = (string) $this->getSetting('action');
    $current = (string) $this->routeMatch->getRouteName();
    $actions = array_filter(
      $this->localActions->getDefinitions(),
      static fn (array $definition, string $id): bool => is_array($definition['dialog'] ?? NULL)
        && ($only === '' ? in_array($current, $definition['appears_on'], TRUE) : $id === $only),
      ARRAY_FILTER_USE_BOTH,
    );
    uasort($actions, static fn (array $a, array $b): int => ($a['weight'] ?? 0) <=> ($b['weight'] ?? 0));
    return $actions;
  }

  /**
   * One action's trigger, or NULL when this screen may not offer it.
   *
   * @param string $id
   *   The local action id.
   * @param array<string, mixed> $dialog
   *   The action's `dialog` options.
   * @param \Drupal\Core\Cache\CacheableMetadata $cacheability
   *   Collects what the answer depends on.
   *
   * @return array<string, mixed>|null
   *   The trigger.
   */
  private function trigger(string $id, array $dialog, CacheableMetadata $cacheability): ?array {
    $action = $this->localActions->createInstance($id);
    assert($action instanceof LocalActionInterface);
    $route_name = $action->getRouteName();
    $parameters = $this->dialogRouteParameters($action);
    $label = (string) $this->localActions->getTitle($action);
    if ($parameters === NULL || $label === '') {
      return NULL;
    }
    $access = $this->accessManager->checkNamedRoute($route_name, $parameters, $this->currentUser, TRUE);
    if ($action instanceof CreateActionAccessInterface) {
      $access = $access->andIf($action->createAccess($this->routeMatch, $this->currentUser));
    }
    $cacheability->addCacheableDependency($access)->addCacheableDependency($action);
    if (!$access->isAllowed()) {
      return NULL;
    }

    return [
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
        'label' => $label,
        'href' => $this->dialogUrl($route_name, $parameters, $dialog, FALSE)->toString(),
        'variant' => 'primary',
        'icon_only' => TRUE,
        'attributes' => $this->withTriggerId((string) ($dialog['trigger_id'] ?? ''), (new Htmx())
          ->get($this->dialogUrl($route_name, $parameters, $dialog, TRUE))
          ->target('#' . self::TARGET_ID)
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
  }

  /**
   * The dialog route's parameters, or NULL when this screen cannot fill them.
   *
   * The action fills each path variable from the screen's raw parameter of the
   * same name (core's LocalActionDefault), over its fixed `route_parameters`.
   *
   * @return array<string, mixed>|null
   *   Route parameters, or NULL for an unknown route or an unfilled variable.
   */
  private function dialogRouteParameters(LocalActionInterface $action): ?array {
    try {
      $route = $this->routeProvider->getRouteByName($action->getRouteName());
    }
    catch (RouteNotFoundException) {
      return NULL;
    }
    $parameters = $action->getRouteParameters($this->routeMatch);
    $missing = array_diff_key(array_flip($route->compile()->getPathVariables()), $parameters, $route->getDefaults());
    return $missing === [] ? $parameters : NULL;
  }

  /**
   * Sets the trigger's id on its attributes, when it has one.
   */
  private function withTriggerId(string $id, Attribute $attributes): Attribute {
    return $id === '' ? $attributes : $attributes->setAttribute('id', $id);
  }

  /**
   * The dialog route, carrying this screen's address and its subject's policy.
   *
   * A MERGE, NEVER A SUFFIX: the forwarded screen keys go in first, the
   * route-bound ones over them, and `destination` is written over the top, so
   * a screen that already carried one cannot smuggle it in as the dialog's.
   * Forwarded values are copied, not checked: the add forms revalidate them.
   *
   * @param string $route_name
   *   The dialog route.
   * @param array<string, mixed> $parameters
   *   The dialog route's parameters.
   * @param array<string, mixed> $dialog
   *   The action's `dialog` options.
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
  private function dialogUrl(string $route_name, array $parameters, array $dialog, bool $through_the_format): Url {
    $query = $this->routeBoundQuery((array) ($dialog['route_query'] ?? [])) + $this->forwardedQuery((array) ($dialog['query'] ?? []));
    $query[self::RETURN_PARAMETER] = $this->currentAddress();
    if ($through_the_format) {
      $query[self::WRAPPER_FORMAT_PARAMETER] = self::WRAPPER_FORMAT_VALUE;
    }

    return Url::fromRoute($route_name, $parameters, ['query' => $query]);
  }

  /**
   * The screen's query keys the action forwards.
   *
   * `*` forwards facet values too, because `PickerWidget` reads a field's
   * opening value off the query key its `context_parameter` names.
   *
   * @param array<int, string> $keys
   *   Query keys, or `*` for all.
   *
   * @return array<string, mixed>
   *   Query keys and values.
   */
  private function forwardedQuery(array $keys): array {
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
   * @param array<string, string> $bindings
   *   Dialog query key => screen route parameter name.
   *
   * @return array<string, string>
   *   Dialog query keys and values.
   */
  private function routeBoundQuery(array $bindings): array {
    $query = [];
    foreach ($bindings as $key => $name) {
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
      $query[self::RETURN_PARAMETER],
      $query[self::WRAPPER_FORMAT_PARAMETER],
      $query['ajax_page_state'],
      $query['_drupal_ajax'],
      $query['_triggering_element_name'],
      $query['_triggering_element_value'],
    );

    return $query;
  }

}
