<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Plugin\UiPatterns\Source;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The newest activity of a run, placed after the run's canonical body.
 */
#[Source(
  id: 'bb_run_activity',
  label: new TranslatableMarkup('[bakers.build] Run activity'),
  description: new TranslatableMarkup('The newest activity of this run.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_run', label: new TranslatableMarkup('Run'), required: TRUE),
  ],
)]
final class BbRunActivitySource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Loads and renders the activity row.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $run = $this->run();
    if ($run === NULL) {
      return [];
    }
    $build = $this->zone(
      (string) $this->t('Activity'),
      $this->activity($run),
      (string) $this->t('No activity for this run'),
    );
    CacheableMetadata::createFromRenderArray($build)
      ->addCacheableDependency($run)
      ->addCacheContexts(['user'])
      ->addCacheTags(['bb_activity_list'])
      ->applyTo($build);
    return $build;
  }

  /**
   * The newest activity whose run_id is this run, rendered full.
   *
   * @return array<string, mixed>
   *   A view builder render array, or empty.
   */
  private function activity(BbRunInterface $run): array {
    $ids = $this->entityTypeManager->getStorage('bb_activity')->getQuery()
      ->accessCheck(TRUE)
      ->condition('run_id', $run->id())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $activity = $ids === [] ? NULL : $this->entityTypeManager->getStorage('bb_activity')->load(reset($ids));
    if (!$activity instanceof BbActivity || !$activity->access('view')) {
      return [];
    }
    return $this->entityTypeManager->getViewBuilder('bb_activity')->view($activity, 'full');
  }

  /**
   * A zone whose content is the given render array or an empty-state.
   *
   * @param string $heading
   *   The zone heading.
   * @param array<string, mixed> $content
   *   The body, or empty.
   * @param string $empty
   *   Empty-state copy when the body is empty.
   *
   * @return array<string, mixed>
   *   The zone.
   */
  private function zone(string $heading, array $content, string $empty): array {
    if ($content === []) {
      $content = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => $empty],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $content,
      ],
    ];
  }

  /**
   * The run this display is rendering, or NULL off a run.
   */
  private function run(): ?BbRunInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbRunInterface ? $entity : NULL;
  }

}
