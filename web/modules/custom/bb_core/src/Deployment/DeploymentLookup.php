<?php

declare(strict_types=1);

namespace Drupal\bb_core\Deployment;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Reads deployment rows and completed target environments for the web UI.
 */
final class DeploymentLookup {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Accessible project deployments, newest first, with project work counts.
   *
   * @return list<array{ticket: \Drupal\bb_core\Entity\BbTicketInterface, environments: list<string>, created: int, count: int}>
   *   Deployment rows.
   */
  public function projectDeployments(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->condition('ticket_type.entity.name', 'deployment')
      ->sort('created', 'DESC')->sort('id', 'DESC')->execute();
    $rows = [];
    foreach ($storage->loadMultiple($ids) as $deployment) {
      assert($deployment instanceof BbTicketInterface);
      $carried = array_column($deployment->get('referenced_tickets')->getValue(), 'target_id');
      $count = 0;
      if ($carried !== []) {
        $query = $storage->getQuery()->accessCheck(TRUE)
          ->condition('id', $carried, 'IN')
          ->condition('project_id', $project->id());
        $query->condition($query->orConditionGroup()
          ->notExists('ticket_type')
          ->condition('ticket_type.entity.name', 'deployment', '<>'));
        $count = (int) $query->count()->execute();
      }
      $rows[] = [
        'ticket' => $deployment,
        'environments' => $this->environmentLabels($deployment),
        'created' => $deployment->getCreatedTime(),
        'count' => $count,
      ];
    }
    return $rows;
  }

  /**
   * Distinct environments of accessible closed deployments, oldest first.
   *
   * @return list<string>
   *   Environment labels.
   */
  public function deployedEnvironments(BbTicketInterface $ticket): array {
    return $this->deployedEnvironmentsMultiple([$ticket])[(int) $ticket->id()] ?? [];
  }

  /**
   * Reads one board batch with one deployment query, including other projects.
   *
   * @param list<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   Board tickets.
   *
   * @return array<int, list<string>>
   *   Environment labels keyed by ticket id.
   */
  public function deployedEnvironmentsMultiple(array $tickets): array {
    $result = [];
    foreach ($tickets as $ticket) {
      if (!$ticket->isNew()) {
        $result[(int) $ticket->id()] = [];
      }
    }
    if ($result === []) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('referenced_tickets', array_keys($result), 'IN')
      ->condition('ticket_type.entity.name', 'deployment')
      ->condition('closed', TRUE)
      ->sort('created', 'ASC')->sort('id', 'ASC')->execute();
    foreach ($storage->loadMultiple($ids) as $deployment) {
      assert($deployment instanceof BbTicketInterface);
      $labels = $this->environmentLabels($deployment);
      foreach ($deployment->get('referenced_tickets')->getValue() as $reference) {
        $id = (int) $reference['target_id'];
        if (isset($result[$id])) {
          $result[$id] = array_values(array_unique([...$result[$id], ...$labels]));
        }
      }
    }
    return $result;
  }

  /**
   * Target names in field order.
   *
   * @return list<string>
   *   Environment labels.
   */
  private function environmentLabels(BbTicketInterface $deployment): array {
    $labels = [];
    foreach ($deployment->get('environments')->referencedEntities() as $environment) {
      $labels[] = (string) $environment->label();
    }
    return array_values(array_unique($labels));
  }

}
