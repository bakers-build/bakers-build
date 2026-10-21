<?php

declare(strict_types=1);

namespace Drupal\island;

use Drupal\Component\Plugin\PluginBase;
use Drupal\Component\Utility\Html;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\island\EventSubscriber\IslandActionSubscriber;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

/**
 * Base class for island plugins.
 *
 * The constructor follows the Drupal plugin dependency-injection idiom:
 * three plugin arguments plus the core services the island helpers need.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 * @SuppressWarnings("PHPMD.CouplingBetweenObjects")
 *
 * NumberOfChildren is suppressed rather than acted on: every island plugin in
 * the product and in the fixtures extends this class, so the count is the
 * number of islands that exist. "Rebalance the hierarchy" is not advice that
 * applies to a plugin base — a second base class would fragment the primitives
 * these plugins are here to share.
 *
 * @SuppressWarnings("PHPMD.NumberOfChildren")
 */
abstract class IslandPluginBase extends PluginBase implements IslandInterface {

  use StringTranslationTrait;

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected EntityTypeManagerInterface $entityTypeManager,
    protected RendererInterface $renderer,
    protected FormBuilderInterface $formBuilder,
    protected IslandPluginManagerInterface $islandManager,
    protected LoggerInterface $logger,
    protected CsrfTokenGenerator $csrfToken,
    protected RequestStack $requestStack,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('renderer'),
      $container->get('form_builder'),
      $container->get('plugin.manager.island'),
      $container->get('logger.factory')->get('island'),
      $container->get('csrf_token'),
      $container->get('request_stack'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function label(): string {
    return (string) ($this->definitionValue('label') ?? '');
  }

  /**
   * {@inheritdoc}
   */
  public function getTypeId(): string {
    return (string) ($this->definitionValue('type') ?? '');
  }

  /**
   * Reads one value from the plugin definition (array or object form).
   */
  private function definitionValue(string $key): mixed {
    $definition = $this->getPluginDefinition();
    if (is_array($definition)) {
      return $definition[$key] ?? NULL;
    }
    return method_exists($definition, $key) ? $definition->{$key}() : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getHtmlId(string $host_id): string {
    $raw = implode('-', ['island', $host_id, $this->getRuntimeIslandId()]);
    // CSS-safe, stable id. Underscores are kept (they are the plugin id
    // convention); only CSS-hostile characters are replaced.
    return Html::cleanCssIdentifier($raw, [':' => '-', ' ' => '-', '/' => '-', '[' => '-', ']' => '']);
  }

  /**
   * Returns the addressable identity of this configured placement.
   *
   * Ordinary hosts have one placement per plugin and therefore retain the
   * plugin id. Profile hosts provide a placement id in the plugin context so
   * that two instances of the same plugin remain independently addressable.
   */
  public function getRuntimeIslandId(): string {
    return (string) ($this->configuration['contexts']['placement_id'] ?? $this->getPluginId());
  }

  /**
   * {@inheritdoc}
   */
  public function boost(): ?IslandBoost {
    // Secure-by-default in the same sense as accessAction(): an island that
    // says nothing gets an ordinary container, and its links are ordinary
    // links. Declaring is opt-in and per island.
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscribedEvents(): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function accessAction(string $action, array $parameters, AccountInterface $account): AccessResultInterface {
    // Secure default: islands opt in per action.
    return AccessResult::forbidden('This island does not allow actions.');
  }

  /**
   * {@inheritdoc}
   */
  public function applyAction(string $action, array $parameters): IslandResponse {
    throw new BadRequestHttpException(sprintf('Unknown island action "%s".', $action));
  }

  /**
   * Builds a fragment-navigation link (D3: GET, core fragment negotiation).
   *
   * The $push_url flag maps 1:1 onto the hx-push-url attribute.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function linkToRoute(string $route_name, array $route_parameters = [], string|TranslatableMarkup $label = '', ?string $target = NULL, bool $push_url = TRUE, array $url_options = []): array {
    $url = Url::fromRoute($route_name, $route_parameters, $url_options);
    $target = $target ?? '#' . $this->getHtmlId($this->hostId());
    $htmx = (new Htmx())
      ->get($url)
      ->onlyMainContent()
      ->select($target)
      ->target($target)
      // The third argument is ignoreTitle, and Htmx::swap() DEFAULTS IT TO
      // TRUE. Left at that default this builder pinned the document title to
      // whatever page the visitor started on. No swap specification either LINK
      // BUILDER writes carries ignoreTitle: a link navigates, and the whole
      // title mechanism is core's, of which this one word is the only way to
      // break it. The two MUTATION swaps — action() below and
      // IslandFormTrait::attachIslandHtmx() — deliberately keep the default: a
      // POST replaces a fragment of the page the visitor is already on, so its
      // response must not move the title.
      //
      // The consequence for a non-pushing link is accepted rather than branched
      // around: such a swap replaces the title although the address bar does
      // not move.
      ->swap('outerHTML', '', FALSE)
      ->pushUrl($push_url);
    $build = [
      '#type' => 'link',
      '#title' => $label,
      '#url' => $url,
    ];
    // applyTo() overwrites #cache; safe only because this build has none and
    // the call is last. Merge like IslandBoost::applyTo() if that changes.
    $htmx->applyTo($build);
    $build['#attached']['library'][] = 'island/base';
    return $build;
  }

  /**
   * Builds a link that replaces the contents of a container the PAGE owns.
   *
   * The difference from linkToRoute() is not computable from the target, which
   * is why it is a separate method rather than a flag: only the component
   * writing the link knows whether the thing being replaced lives in the
   * response fragment or only in the document. hx-target resolves against the
   * live document, so a container id the theme writes is a perfectly good
   * target; hx-select resolves against the fragment, where that id does not
   * appear — and it is not needed, because a Drupal htmx fragment is already
   * exactly the page's main content.
   *
   * The swap is innerHTML, so the container itself is never replaced and can
   * never be removed from the document.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function linkToPage(string $route_name, array $route_parameters, string|TranslatableMarkup $label, string $target, bool $push_url = TRUE, array $url_options = []): array {
    $url = Url::fromRoute($route_name, $route_parameters, $url_options);
    $htmx = (new Htmx())
      ->get($url)
      ->onlyMainContent()
      ->target($target)
      // The third argument is ignoreTitle and Htmx::swap() defaults it to TRUE.
      // No swap specification either LINK BUILDER writes carries it, because
      // the title mechanism is entirely core's and this one word is the only
      // way to break it. The module's two mutation swaps keep the default on
      // purpose — see linkToRoute() above.
      ->swap('innerHTML', '', FALSE)
      ->pushUrl($push_url);
    $build = [
      '#type' => 'link',
      '#title' => $label,
      '#url' => $url,
    ];
    // applyTo() OVERWRITES #cache rather than merging it — see linkToRoute().
    $htmx->applyTo($build);
    $build['#attached']['library'][] = 'island/base';
    return $build;
  }

  /**
   * Builds an action link (D3: POST + CSRF token to the page it is shown on).
   *
   * The link posts to the current page, so the action runs in the page's own
   * request; IslandActionSubscriber answers it before the page controller.
   * The island, action, host and token travel in the POST body next to the
   * parameters, keeping the page's own query intact.
   *
   * The $confirm flag maps 1:1 onto the hx-confirm attribute.
   *
   * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
   */
  protected function action(string $action, array $parameters = [], string|TranslatableMarkup $label = '', bool $confirm = FALSE): array {
    $request = $this->requestStack->getCurrentRequest();
    $query = $request?->query->all() ?? [];
    unset($query['ajax_page_state'], $query['_wrapper_format']);
    $url = Url::fromUri('base:' . ltrim(rawurldecode($request?->getPathInfo() ?? '/'), '/'), ['query' => $query]);
    // CSRF tokens are seeded per session. Without session user data the
    // session is never saved (core treats a metadata-only session as
    // obsolete), so an anonymous user's token could never validate on the
    // follow-up POST. Force a persisted session first — starting it stamps a
    // fresh seed, so this must happen before the token is generated.
    $session = $request?->getSession();
    if ($session !== NULL && !$session->isStarted()) {
      $session->start();
      $session->set('island_csrf', 1);
    }
    $island_id = $this->getRuntimeIslandId();
    $values = [
      IslandActionSubscriber::ISLAND => $island_id,
      IslandActionSubscriber::ACTION => $action,
      IslandActionSubscriber::HOST => $this->hostId(),
      IslandActionSubscriber::TOKEN => $this->csrfToken->get(IslandActionSubscriber::tokenSeed($island_id, $action)),
    ] + $parameters;
    // `select()` matches what IslandWrapper::wrap() always puts on the
    // fragment's own root (its `id` attribute) — without it, htmx resolves
    // `hx-select` by walking up the DOM from the clicked link, and a shell
    // host's own boost-navigation `hx-select` (declared on an ancestor for an
    // unrelated boosted GET) gets inherited onto this mutation instead. The
    // response then gets filtered for an id it never contains, so nothing
    // matches and the swap silently empties the target (BB-661 review: the
    // addons card going blank after a send). `poll()` in AddonPanelIsland
    // already guards the same way; this gives every action() link the same
    // guard.
    $selfId = '#' . $this->getHtmlId($this->hostId());
    $htmx = (new Htmx())
      ->post($url)
      ->vals($values)
      ->target($selfId)
      ->select($selfId)
      ->swap('outerHTML');
    if ($confirm) {
      $htmx->confirm((string) ($label === '' ? $this->t('Are you sure?') : $this->t('Are you sure you want to @action?', ['@action' => mb_strtolower((string) $label)])));
    }
    // A plain link: the host that places the action decides how it looks.
    $build = [
      '#type' => 'link',
      '#title' => $label === '' ? $action : $label,
      '#url' => $url,
    ];
    $htmx->applyTo($build);
    // The link names its page, so it varies by it.
    $build['#cache']['contexts'] = ['url.path', 'url.query_args'];
    $build['#attached']['library'][] = 'island/base';
    return $build;
  }

  /**
   * Builds an island form wired to this island instance (D3: Form primitive).
   */
  protected function getForm(string $form_class, array $args = []): array {
    return $this->formBuilder->getForm($form_class, [
      'island_id' => $this->getRuntimeIslandId(),
      'host_id' => $this->hostId(),
    ] + $args);
  }

  /**
   * Returns the host context provider this instance was created with, if any.
   */
  protected function host(): ?IslandContextProviderInterface {
    $host = $this->configuration['contexts']['host'] ?? NULL;
    return $host instanceof IslandContextProviderInterface ? $host : NULL;
  }

  /**
   * Returns the current host id or throws when the island has no host context.
   */
  protected function hostId(): string {
    $host = $this->host();
    if ($host === NULL) {
      throw new \LogicException(sprintf('Island "%s" was created without a host context.', $this->getPluginId()));
    }
    return $host->hostId();
  }

}
