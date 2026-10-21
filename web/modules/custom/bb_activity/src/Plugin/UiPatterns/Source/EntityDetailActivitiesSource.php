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
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Activities zone of an entity detail page, with a manual Refresh.
 *
 * Refresh fetches the page's main content and swaps this zone alone, so
 * forms elsewhere on the page keep their unsent input.
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
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->activities = $container->get(EntityDetailActivities::class);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return [];
    }
    if (!$entity instanceof EntityInterface || $entity->isNew() || !$entity->access('view')) {
      return [];
    }
    $content = [];
    $builder = $this->entityTypeManager->getViewBuilder('bb_activity');
    foreach ($this->activities->activities($entity) as $activity) {
      $content[] = $builder->view($activity, 'full');
    }
    if ($content === []) {
      $content[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $this->t('No activity yet.')],
      ];
    }
    $refresh = (new Htmx())->get($entity->toUrl())->onlyMainContent()
      ->target('#' . self::ZONE_ID)->select('#' . self::ZONE_ID)
      ->swap('outerHTML')->pushUrl(FALSE)->getAttributes();
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'inset' => 'none',
        'gap' => 'sm',
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
        'content' => $content,
      ],
    ];
    CacheableMetadata::createFromObject($entity)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_ticket_list', 'bb_activity_list', 'bb_run_list', 'bb_conductor_list'])
      ->applyTo($build);
    return $build;
  }

}
