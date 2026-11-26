<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\BbRankEntityFence;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Offers the active workspace's projects the reader may create tickets in.
 *
 * The create dialog's Project picker names it, so a reader is never offered
 * a project the ticket's BbGroupScope constraint would refuse.
 *
 * shortcut: one access check per workspace project after the query; move it
 * into the query if a workspace ever holds hundreds of projects.
 */
#[EntityReferenceSelection(
  id: 'bb_project_ticket_creatable',
  label: new TranslatableMarkup('Projects of the active workspace the reader may create tickets in'),
  entity_types: ['bb_project'],
  group: 'bb_project_ticket_creatable',
  weight: 0,
)]
class ProjectTicketCreatableSelection extends ProjectInActiveWorkspaceSelection {

  /**
   * The fence that decides where the reader may create.
   */
  protected BbRankEntityFence $fence;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->fence = $container->get('bb_core.rank_entity_fence');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getReferenceableEntities($match = NULL, $match_operator = 'CONTAINS', $limit = 0) {
    $options = parent::getReferenceableEntities($match, $match_operator, $limit);
    foreach ($options as $bundle => $labels) {
      $options[$bundle] = array_intersect_key($labels, array_flip($this->creatable(array_keys($labels))));
    }
    return array_filter($options);
  }

  /**
   * {@inheritdoc}
   */
  public function countReferenceableEntities($match = NULL, $match_operator = 'CONTAINS') {
    return array_sum(array_map('count', $this->getReferenceableEntities($match, $match_operator)));
  }

  /**
   * {@inheritdoc}
   */
  public function validateReferenceableEntities(array $ids) {
    return $this->creatable(parent::validateReferenceableEntities($ids));
  }

  /**
   * Keeps the project ids the reader may create a ticket in.
   *
   * @param array<int|string> $ids
   *   Project ids.
   *
   * @return array<int|string>
   *   The creatable ones, in order.
   */
  private function creatable(array $ids): array {
    $projects = $this->entityTypeManager->getStorage('bb_project')->loadMultiple($ids);
    return array_values(array_filter(
      $ids,
      fn ($id): bool => isset($projects[$id]) && $this->fence->mayCreateIn($this->currentUser, 'bb_ticket', $projects[$id]),
    ));
  }

}
