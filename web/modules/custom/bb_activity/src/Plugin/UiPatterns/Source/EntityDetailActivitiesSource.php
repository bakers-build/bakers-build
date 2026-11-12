<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Template\Attribute;
use Drupal\Core\Plugin\Context\ContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Activity\EntityDetailActivities;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Ticket\ProjectOverviewTickets;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginManager;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Activities zone of an entity detail page, with a manual Refresh.
 *
 * Refresh fetches the page's main content and swaps this zone alone, so
 * forms elsewhere on the page keep their unsent input. A project lists
 * compact rows, and no zone while the viewer sees none of its tickets.
 */
#[Source(
  id: 'bb_entity_detail_activities',
  label: new TranslatableMarkup('[bakers.build] Detail activities'),
  description: new TranslatableMarkup('Recent ticket activities of the detail entity, newest first.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new ContextDefinition('entity', label: new TranslatableMarkup('Entity'), required: TRUE),
  ],
)]
final class EntityDetailActivitiesSource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * The zone's element id; one feed per page.
   */
  public const ZONE_ID = 'entity-detail-activities';

  /**
   * Selects the feed rows.
   */
  protected EntityDetailActivities $activities;

  /**
   * Renders activity rows.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * Tells whether a project has tickets the viewer may view.
   */
  protected ProjectOverviewTickets $overview;

  /**
   * Builds a project's compact activity rows.
   */
  protected SourcePluginManager $sources;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->activities = $container->get(EntityDetailActivities::class);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->overview = $container->get(ProjectOverviewTickets::class);
    $instance->sources = $container->get('plugin.manager.ui_patterns_source');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $entity = $this->viewableEntity();
    if ($entity === NULL) {
      return [];
    }
    $project = $entity instanceof BbProjectInterface;
    if ($project && !$this->overview->hasTickets($entity)) {
      // Nothing to show until a ticket the viewer may view arrives.
      return ['#cache' => ['contexts' => ['user'], 'tags' => ['bb_ticket_list']]];
    }
    $build = $this->zone($entity, $project);
    CacheableMetadata::createFromObject($entity)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_ticket_list', 'bb_activity_list', 'bb_run_list', 'bb_conductor_list'])
      ->applyTo($build);
    return $build;
  }

  /**
   * The context entity, when saved and viewable by the current user.
   */
  private function viewableEntity(): ?EntityInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    $viewable = $entity instanceof EntityInterface && !$entity->isNew() && $entity->access('view');
    return $viewable ? $entity : NULL;
  }

  /**
   * The activity rows, or the empty state.
   *
   * @return array<int, array<string, mixed>>
   *   The render arrays of the zone content.
   */
  private function rows(EntityInterface $entity, bool $project): array {
    $builder = $this->entityTypeManager->getViewBuilder('bb_activity');
    $content = [];
    foreach ($this->activities->activities($entity) as $activity) {
      $content[] = $project ? $this->compactRow($activity) : $builder->view($activity, 'full');
    }
    $empty = [
      '#type' => 'component',
      '#component' => 'bb_theme:empty-state',
      '#props' => ['message' => (string) $this->t('No activity yet.')],
    ];
    return $content ?: [$empty];
  }

  /**
   * The zone with its Refresh action around the rows.
   *
   * @return array<string, mixed>
   *   The `bb_theme:zone` render array.
   */
  private function zone(EntityInterface $entity, bool $project): array {
    $refresh = (new Htmx())->get($entity->toUrl())->onlyMainContent()
      ->target('#' . self::ZONE_ID)->select('#' . self::ZONE_ID)
      ->swap('outerHTML')->pushUrl(FALSE)->getAttributes();
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'inset' => 'none',
        // Compact rows carry their own hairline and sit edge to edge.
        'gap' => $project ? 'none' : 'sm',
        'attributes' => new Attribute(['id' => self::ZONE_ID]),
      ],
      '#slots' => [
        'heading' => ['#plain_text' => (string) $this->t('Activities')],
        'actions' => [
          '#type' => 'component',
          '#component' => 'bb_theme:button',
          '#props' => [
            'label' => (string) $this->t('Refresh'),
            'variant' => 'neutral',
            'attributes' => $refresh,
          ],
        ],
        'content' => $this->rows($entity, $project),
      ],
    ];
  }

  /**
   * One activity as the compact row of the project Overview.
   *
   * @return array<string, mixed>
   *   The `bb_theme:event` render array, or empty.
   */
  private function compactRow(EntityInterface $activity): array {
    $configuration = SourcePluginBase::buildConfiguration($this->getPropId(), $this->getPropDefinition(), ['source' => ['compact' => TRUE]], []);
    $source = $this->sources->createInstance('bb_activity_event', $configuration);
    assert($source instanceof SourcePluginBase);
    $source->setContextValue('entity', $activity);
    return $source->getPropValue();
  }

}
