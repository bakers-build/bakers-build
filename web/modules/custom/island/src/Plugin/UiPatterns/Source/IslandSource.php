<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\UiPatterns\Source;

use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Utility\Token;
use Drupal\island\IslandBoost;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandWrapper;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\Element\ComponentElementBuilder;
use Drupal\ui_patterns\Entity\SampleEntityGeneratorInterface;
use Drupal\ui_patterns\PropTypePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\UiPatternsNormalizerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Puts an island container into a slot, from configuration.
 *
 * The only island carrier in a Display Builder page layout: ui_patterns'
 * `BlockSource` bypasses `BlockViewBuilder`, so block placements cannot carry
 * one. It writes no attribute of its own; `IslandBoost` is the single author
 * of `hx-select-oob` and `X-Island-Also`. The content is a nested source list
 * so it can wrap a component or `main_page_content`. The long constructor is
 * the `SourcePluginBase` injection idiom.
 *.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
#[Source(
  id: 'island',
  label: new TranslatableMarkup('Island'),
  description: new TranslatableMarkup('Wraps content in an HTMX island container with its own id and swap target.'),
  prop_types: ['slot'],
)]
final class IslandSource extends SourcePluginBase {

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
    private readonly ComponentElementBuilder $componentElementBuilder,
    private readonly IslandHostResolver $hostResolver,
    private readonly IslandPluginManagerInterface $islandManager,
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
      $container->get('ui_patterns.component_element_builder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultSettings(): array {
    return [
      // Plugin mode.
      'host' => '',
      'island' => '',
      // Configuration mode.
      'island_id' => '',
      'swap_target' => '',
      'content' => [],
    ];
  }

  /**
   * {@inheritdoc}
   *
   * Plugin mode (`host` + `island`): the container has the plugin's html id
   * and is addressable, so it can be re-rendered after a mutation.
   * Configuration mode (`island_id` + `swap_target` + nested sources):
   * resolves to nothing server-side; htmx extracts it client-side via
   * `hx-select`. Enough for a container that only frames content.
   */
  public function getPropValue(): mixed {
    $plugin = $this->pluginModeIsland();
    if ($plugin !== NULL) {
      return $plugin;
    }
    $island_id = trim((string) ($this->getSetting('island_id') ?? ''));
    if ($island_id === '') {
      // An island with no id has no addressable container, and
      // IslandBoost::applyTo() would throw on the missing #attributes['id'].
      // Returning nothing is the honest answer: the configuration is
      // incomplete, and a half-built container would be worse than none.
      return [];
    }
    $swap_target = trim((string) ($this->getSetting('swap_target') ?? ''));

    return IslandWrapper::wrap(
      $island_id,
      $this->buildContent(),
      FALSE,
      // An EMPTY target means the container itself, which is the content
      // island's case: it is already the main fragment and cannot ride along
      // with itself. IslandBoost::to(NULL) is that, and it is not the same as
      // "no declaration".
      IslandBoost::to($swap_target === '' ? NULL : $swap_target),
    );
  }

  /**
   * Plugin mode: the island named by `host` + `island`, or NULL.
   *
   * Every id, the data and the declaration come from the module, not from this
   * placement — the same rule `IslandResponder::createIsland()` follows, so a
   * placed island and a re-rendered one are one answer rather than two.
   */
  private function pluginModeIsland(): ?array {
    $host_id = trim((string) ($this->getSetting('host') ?? ''));
    $island_id = trim((string) ($this->getSetting('island') ?? ''));
    if ($host_id === '' || $island_id === '') {
      return NULL;
    }
    $host = $this->hostResolver->resolve($host_id);
    if ($host === NULL || !in_array($island_id, $host->getIslandIds(), TRUE)) {
      // A placement naming a host or island that no longer exists renders
      // nothing rather than fataling: configuration outlives code, and a page
      // that dies because one region was retired is worse than a page with a
      // gap where the retirement is visible.
      return NULL;
    }
    $configuration = $host->getIslandConfiguration($island_id);
    $configuration['contexts']['host'] = $host;
    $configuration['contexts']['placement_id'] = $island_id;
    $island = $this->islandManager->createInstance($this->hostResolver->pluginId($island_id, $host), $configuration);
    if (!$island instanceof IslandInterface) {
      return NULL;
    }
    return IslandWrapper::wrap(
      $island->getHtmlId($host_id),
      $island->build($host->getIslandData($island_id)),
      FALSE,
      $island->boost(),
      array_keys($island->getSubscribedEvents()),
    );
  }

  /**
   * Builds the nested source list this island wraps.
   *
   * The same two lines `DisplayBuilderPageVariant::build()` uses for a page's
   * top-level sources, because the shape is the same shape: a list of source
   * configurations rendered into one slot.
   */
  private function buildContent(): array {
    $content = $this->getSetting('content');
    if (!is_array($content) || $content === []) {
      return [];
    }
    $build = [];
    foreach ($content as $source) {
      if (!is_array($source) || empty($source['source_id'])) {
        continue;
      }
      $one = $this->componentElementBuilder->buildSource([], 'content', [], $source, $this->context);
      $build[] = is_array($one) ? ($one['#slots']['content'][0] ?? []) : [];
    }
    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form = parent::settingsForm($form, $form_state);
    $form['host'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Island host'),
      '#description' => $this->t('Host id of a real island plugin. Set this together with the island id below to place a plugin — the only mode in which the island can change content, because only then is it addressable for a re-render.'),
      '#default_value' => (string) ($this->getSetting('host') ?? ''),
    ];
    $form['island'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Island plugin'),
      '#description' => $this->t('Island plugin id, as the host declares it.'),
      '#default_value' => (string) ($this->getSetting('island') ?? ''),
    ];
    $form['island_id'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Island id'),
      '#description' => $this->t("The container's DOM id, for example island-content. It is what other containers target, and it is written here once — nothing repeats it. Used only when no island plugin is named above: the container is then built from configuration alone and is not addressable, which is enough to frame content and not enough to change it."),
      '#default_value' => (string) ($this->getSetting('island_id') ?? ''),
    ];
    $form['swap_target'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Swap target'),
      '#description' => $this->t('CSS selector of the container the links inside this island replace, for example #island-content. Leave empty for an island that replaces itself.'),
      '#default_value' => (string) ($this->getSetting('swap_target') ?? ''),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSummary(): array {
    $island_id = (string) ($this->getSetting('island_id') ?? '');
    $swap_target = (string) ($this->getSetting('swap_target') ?? '');
    return array_filter([
      $island_id,
      $swap_target === '' ? '' : '→ ' . $swap_target,
    ]);
  }

}
