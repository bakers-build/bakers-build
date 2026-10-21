<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Plugin\EntityReferenceSelection\DefaultSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Scopes selectable tickets to open tickets in the referring ticket's project.
 *
 * A saved referring ticket is never offered to itself.
 *
 * Never a field handler: the create and property form displays select it
 * for their relation pickers through the `bb_picker` `selection_handler`
 * setting, so API, CLI and the Settings form keep the field's default
 * handler. The access-checked query of DefaultSelection still applies.
 *
 * There is no current-reference escape: a relation a saved ticket already
 * holds is kept by the widget and the forms' rule, not offered here.
 */
#[EntityReferenceSelection(
  id: 'bb_ticket_in_ticket_project',
  label: new TranslatableMarkup("Tickets in the ticket's project"),
  entity_types: ['bb_ticket'],
  group: 'bb_ticket_in_ticket_project',
  weight: 0,
)]
class TicketInTicketProjectSelection extends DefaultSelection {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    $entity = $this->configuration['entity'] ?? NULL;
    if ($entity instanceof BbTicketInterface) {
      $projectId = $entity->get('project_id')->target_id;
      // `0` is never a valid id: a ticket without a project offers nothing.
      $query->condition('project_id', $projectId !== NULL && $projectId !== '' ? $projectId : 0);
      if (!$entity->isNew()) {
        $query->condition('id', $entity->id(), '<>');
      }
    }
    $query->condition($query->orConditionGroup()
      ->condition('closed', TRUE, '<>')
      ->notExists('closed'));
    return $query;
  }

}
