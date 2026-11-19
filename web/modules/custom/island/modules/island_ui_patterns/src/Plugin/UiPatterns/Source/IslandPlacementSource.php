<?php

declare(strict_types=1);

namespace Drupal\island_ui_patterns\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\Context\ContextRepositoryInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Utility\Token;
use Drupal\island\Entity\IslandProfileInterface;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandProfileRenderer;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\Entity\SampleEntityGeneratorInterface;
use Drupal\ui_patterns\PropTypePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\ui_patterns\UiPatternsNormalizerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Renders a profile placement from the reserved `embedded` slot in a slot.
 *
 * The placement is built by the profile renderer, so it keeps its island
 * wrapper, events and html id, and its actions and events work as they do
 * for a placement in a layout slot. The long constructor is the
 * `SourcePluginBase` injection idiom.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
#[Source(
  id: 'island_placement',
  label: new TranslatableMarkup('Island placement'),
  description: new TranslatableMarkup('Renders an embedded placement of the current island profile.'),
  prop_types: ['slot'],
)]
final class IslandPlacementSource extends SourcePluginBase {

  /**
   * The context key under which an island component passes its host.
   */
  public const HOST_CONTEXT = 'island_host';

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
    protected readonly IslandProfileRenderer $profileRenderer,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition, $propTypeManager, $contextRepository, $routeMatch, $sampleEntityGenerator, $moduleHandler, $token, $normalizer);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
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
      $container->get('island.profile_renderer'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultSettings(): array {
    return ['placement' => ''];
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $context = $this->context[self::HOST_CONTEXT] ?? NULL;
    $host = $context?->getContextValue();
    $placement_id = trim((string) ($this->getSetting('placement') ?? ''));
    // Outside a profile, or for a placement that is not embedded, there is
    // nothing this slot may render.
    if (!$host instanceof IslandProfileHost || $placement_id === ''
      || $host->getProfile()->getPlacement($placement_id)['slot'] !== IslandProfileInterface::EMBEDDED_SLOT) {
      return [];
    }
    $cache = new CacheableMetadata();
    $build = $this->profileRenderer->buildPlacement($host, $placement_id, $cache) ?? [];
    $cache->applyTo($build);
    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $form = parent::settingsForm($form, $form_state);
    $form['placement'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Placement'),
      '#description' => $this->t('Id of a placement in the profile\'s "embedded" slot.'),
      '#default_value' => (string) ($this->getSetting('placement') ?? ''),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSummary(): array {
    return array_filter([(string) ($this->getSetting('placement') ?? '')]);
  }

}
