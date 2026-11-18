<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Form\BbRestartRunsForm;
use Drupal\bb_core\Ticket\TicketInterventions;

/**
 * Provides the admin listing table for bakers.build conductor entities.
 *
 * Displays each conductor's registration key and current operational status.
 */
final class BbConductorListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'label' => $this->t('Label'),
      'status' => $this->t('Status'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbConductorInterface);
    return [
      'label' => $entity->label(),
      'status' => $entity->getStatus(),
    ] + parent::buildRow($entity);
  }

  /**
   * {@inheritdoc}
   *
   * Adds Restart runs for the owner of the conductor's machine.
   */
  protected function getDefaultOperations(EntityInterface $entity): array {
    $operations = parent::getDefaultOperations($entity);
    if ($entity instanceof BbConductorInterface && TicketInterventions::mayRestartRuns($entity, \Drupal::currentUser())) {
      $operations['restart'] = [
        'title' => $this->t('Restart runs'),
        'weight' => 50,
        'url' => BbRestartRunsForm::confirmationUrl($entity, FALSE),
      ];
    }
    return $operations;
  }

}
