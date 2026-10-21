<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\UiPatterns\Source;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\ui_patterns\Attribute\Source;
use Drupal\ui_patterns\SourcePluginBase;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Live occupancy and the tickets occupying one conductor.
 */
#[Source(
  id: 'bb_conductor_occupancy',
  label: new TranslatableMarkup('[bakers.build] Conductor occupancy'),
  description: new TranslatableMarkup('Live occupancy and the tickets running on this conductor.'),
  prop_types: ['slot'],
  context_definitions: [
    'entity' => new EntityContextDefinition('entity:bb_conductor', label: new TranslatableMarkup('Conductor'), required: TRUE),
  ],
)]
final class ConductorOccupancySource extends SourcePluginBase implements ContainerFactoryPluginInterface {

  /**
   * Loads runs occupying the conductor.
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * Request time for the live-lease comparison.
   */
  protected TimeInterface $time;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->entityTypeManager = $container->get('entity_type.manager');
    $instance->time = $container->get('datetime.time');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getPropValue(): mixed {
    $conductor = $this->conductor();
    if ($conductor === NULL || $conductor->isNew() || !$conductor->access('view')) {
      return [];
    }

    $ids = $this->liveRunIds($conductor);
    $ticket_ids = $this->visibleTicketIds($ids);
    $build = [
      'load' => [
        '#plain_text' => $this->t('Live occupancy: @count', ['@count' => count($ids)]),
      ],
      'heading' => [
        '#plain_text' => $this->t('Running tickets'),
      ],
      'note' => [
        '#plain_text' => $this->t('Only tickets you may inspect are listed.'),
      ],
      '#cache' => ['max-age' => 0],
    ];
    if ($ticket_ids !== []) {
      $build['tickets'] = [
        '#type' => 'view',
        '#name' => 'conductor_tickets',
        '#display_id' => 'occupancy',
        '#arguments' => [implode('+', $ticket_ids)],
      ];
      return $build;
    }
    $build['empty'] = [
      '#plain_text' => $ids === []
        ? $this->t('No running tickets.')
        : $this->t('No running tickets visible to you.'),
    ];
    return $build;
  }

  /**
   * {@inheritdoc}
   */
  public function alterComponent(array $element): array {
    $element = parent::alterComponent($element);
    $metadata = CacheableMetadata::createFromRenderArray($element);
    $metadata->setCacheMaxAge(0);
    $conductor = $this->conductor();
    if ($conductor !== NULL) {
      $metadata->addCacheableDependency($conductor);
    }
    $metadata->applyTo($element);
    return $element;
  }

  /**
   * Live run ids on this conductor (running, or claimed with a live lease).
   *
   * @return array<string|int, string>
   *   Storage ids of occupying runs.
   */
  private function liveRunIds(BbConductorInterface $conductor): array {
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $now = (int) $this->time->getRequestTime();
    $query = $storage->getQuery()->accessCheck(FALSE)
      ->condition('conductor_id', $conductor->id());
    $live = $query->orConditionGroup()
      ->condition('state', 'running')
      ->condition($query->andConditionGroup()
        ->condition('state', 'claimed')
        ->condition($query->orConditionGroup()
          ->condition('claim_expires_at', 0)
          ->condition('claim_expires_at', $now, '>=')));
    return $query->condition($live)->execute();
  }

  /**
   * Distinct ticket ids the current user may inspect from occupying runs.
   *
   * @param array<string|int, string> $run_ids
   *   Occupying run ids.
   *
   * @return array<int, int>
   *   Ticket entity ids keyed by themselves.
   */
  private function visibleTicketIds(array $run_ids): array {
    // ponytail: loads the conductor's active set in memory and can become a
    // paged projection only if measured active-set size requires it.
    $ticket_ids = [];
    foreach ($this->entityTypeManager->getStorage('bb_run')->loadMultiple($run_ids) as $run) {
      if (!$run instanceof BbRunInterface || !$run->access('view')) {
        continue;
      }
      $ticket = $run->get('ticket_id')->entity;
      if ($ticket === NULL || !$ticket->access('view')) {
        continue;
      }
      $ticket_ids[(int) $ticket->id()] = (int) $ticket->id();
    }
    return $ticket_ids;
  }

  /**
   * Returns the conductor context, if present.
   */
  private function conductor(): ?BbConductorInterface {
    try {
      $entity = $this->getContextValue('entity');
    }
    catch (\Exception) {
      return NULL;
    }
    return $entity instanceof BbConductorInterface ? $entity : NULL;
  }

}
